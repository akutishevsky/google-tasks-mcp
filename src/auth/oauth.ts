import { Hono } from "hono";
import crypto from "node:crypto";
import type { AppDeps } from "../deps.ts";
import { createOAuthStore } from "./oauth-store.ts";
import { exchangeCode } from "../google/oauth.ts";
import { parseIdToken } from "./id-token.ts";
import { pkceS256, randomToken } from "./tokens.ts";
import { isAllowedRedirectUri, isValidRedirectUri } from "./redirect-uris.ts";
import { ACCESS_TTL_MS } from "./token-store.ts";
import type { TokenStore } from "./token-store.ts";
import { createLogger } from "../utils/logger.ts";
import { rateLimit } from "../server/rate-limiter.ts";

const logger = createLogger({ component: "oauth" });

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

const GOOGLE_SCOPE = "openid email https://www.googleapis.com/auth/tasks";

export function createOAuthRouter(deps: AppDeps, tokenStore: TokenStore) {
  const config = deps.config.google;
  const oauthStore = createOAuthStore(deps);
  const oauth = new Hono();

  oauth.post(
    "/register",
    rateLimit(deps, { maxRequests: 30, windowMs: 3600000 }),
    async (c) => {
      let body: { redirect_uris?: unknown } | null = null;
      try {
        body = await c.req.json();
      } catch {
        // falls through to invalid_client_metadata
      }
      const uris = body?.redirect_uris;
      if (!Array.isArray(uris) || uris.length === 0 || !uris.every(isValidRedirectUri)) {
        logger.warn("Client registration rejected: invalid redirect_uris");
        return c.json(
          {
            error: "invalid_client_metadata",
            error_description: "redirect_uris must be a non-empty array of https or loopback http URIs",
          },
          400,
        );
      }
      if (!uris.every((u) => isAllowedRedirectUri(u, deps.config.allowedRedirectUris))) {
        logger.warn("Client registration rejected: redirect_uri not allowed by this server");
        return c.json({ error: "invalid_redirect_uri", error_description: "redirect_uri is not allowed by this server" }, 400);
      }

      const clientId = crypto.randomUUID();
      await oauthStore.registerClient(clientId, { clientId, redirectUris: uris });

      logger.info("OAuth client registered");

      return c.json({
        client_id: clientId,
        redirect_uris: uris,
      });
    }
  );

  oauth.get(
    "/authorize",
    rateLimit(deps, { maxRequests: 60, windowMs: 3600000 }),
    async (c) => {
    const responseType = c.req.query("response_type");
    const clientId = c.req.query("client_id");
    const redirectUri = c.req.query("redirect_uri");
    const state = c.req.query("state");
    const codeChallenge = c.req.query("code_challenge");
    const codeChallengeMethod = c.req.query("code_challenge_method");

    if (responseType !== "code") {
      logger.warn("OAuth authorization failed: unsupported response type");
      return c.json({ error: "unsupported_response_type" }, 400);
    }

    // Never redirect to a URI the client did not register: answer 400 here.
    const client = clientId ? await oauthStore.getClient(clientId) : null;
    if (!client) {
      logger.warn("OAuth authorization failed: unknown client_id");
      return c.json({ error: "invalid_client", error_description: "Unknown client_id" }, 400);
    }

    if (!redirectUri) {
      logger.warn("OAuth authorization failed: missing redirect_uri");
      return c.json({ error: "invalid_request", error_description: "redirect_uri is required" }, 400);
    }

    if (
      !Array.isArray(client.redirectUris) ||
      !client.redirectUris.includes(redirectUri) ||
      !isAllowedRedirectUri(redirectUri, deps.config.allowedRedirectUris)
    ) {
      logger.warn("OAuth authorization failed: redirect_uri not registered for client");
      return c.json({ error: "invalid_request", error_description: "redirect_uri is not registered for this client" }, 400);
    }

    // PKCE is mandatory (OAuth 2.1, MCP authorization): S256 only.
    if (!codeChallenge || codeChallengeMethod !== "S256") {
      logger.warn("OAuth authorization failed: PKCE S256 required");
      return c.json({ error: "invalid_request", error_description: "code_challenge with code_challenge_method=S256 is required" }, 400);
    }

    if (!state) {
      logger.warn("OAuth authorization failed: missing state parameter");
      return c.json({ error: "invalid_request", error_description: "state parameter is required for CSRF protection" }, 400);
    }

    logger.info("Starting OAuth authorization flow");

    const internalState = crypto.randomUUID();

    await oauthStore.storeSession(internalState, {
      state,
      codeChallenge,
      codeChallengeMethod,
      redirectUri,
      clientId,
    });

    const googleAuthUrl = new URL(GOOGLE_AUTH_URL);
    googleAuthUrl.searchParams.append("response_type", "code");
    googleAuthUrl.searchParams.append("client_id", config.clientId);
    googleAuthUrl.searchParams.append("redirect_uri", config.redirectUri);
    googleAuthUrl.searchParams.append("scope", GOOGLE_SCOPE);
    googleAuthUrl.searchParams.append("state", internalState);
    googleAuthUrl.searchParams.append("access_type", "offline");
    googleAuthUrl.searchParams.append("prompt", "consent");
    if (deps.config.allowedDomain) {
      // A hint for Google's account chooser; /callback enforces the domain.
      googleAuthUrl.searchParams.append("hd", deps.config.allowedDomain);
    }

    return c.redirect(googleAuthUrl.toString());
    }
  );

  oauth.get("/callback", async (c) => {
    const code = c.req.query("code");
    const internalState = c.req.query("state");

    if (!code || !internalState) {
      logger.warn("OAuth callback failed: missing code or state");
      return c.json({ error: "invalid_request" }, 400);
    }

    const session = await oauthStore.getSession(internalState);
    if (!session) {
      logger.warn("OAuth callback failed: invalid or expired state");
      return c.json({ error: "invalid_state" }, 400);
    }

    logger.info("Processing OAuth callback from Google");

    // Exchange here, not at /token, so the id_token is available to check.
    let google;
    try {
      google = await exchangeCode(deps, code);
    } catch {
      return c.json({ error: "server_error", error_description: "Failed to exchange the Google authorization code" }, 502);
    }
    const claims = parseIdToken(google.idToken);
    const domain = deps.config.allowedDomain;
    if (domain && (claims.hd !== domain || !claims.email_verified)) {
      logger.warn("OAuth callback rejected: account outside the allowed domain");
      await oauthStore.deleteSession(internalState);
      return c.text("This Google account is not allowed to use this server.", 403);
    }

    const authCode = randomToken();

    await oauthStore.storeAuthCode(authCode, {
      clientId: session.clientId!,
      redirectUri: session.redirectUri,
      codeChallenge: session.codeChallenge,
      email: claims.email,
      encGoogleAccess: await deps.cipher.encrypt(google.accessToken),
      encGoogleRefresh: await deps.cipher.encrypt(google.refreshToken),
      googleExpiresAt: deps.clock() + google.expiresIn * 1000,
    });

    await oauthStore.deleteSession(internalState);

    const redirectUrl = new URL(session.redirectUri);
    redirectUrl.searchParams.append("code", authCode);
    redirectUrl.searchParams.append("state", session.state);

    return c.redirect(redirectUrl.toString());
  });

  oauth.post(
    "/token",
    rateLimit(deps, { maxRequests: 100, windowMs: 3600000 }),
    async (c) => {
    const body = await c.req.parseBody();
    const grantType = body.grant_type;
    const clientId = typeof body.client_id === "string" ? body.client_id : "";

    const issued = (pair: { accessToken: string; refreshToken: string }) =>
      c.json({
        access_token: pair.accessToken,
        token_type: "Bearer",
        expires_in: ACCESS_TTL_MS / 1000,
        refresh_token: pair.refreshToken,
      });

    if (grantType === "refresh_token") {
      const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
      const result = refreshToken ? await tokenStore.rotateRefresh(refreshToken, clientId) : { error: "invalid_grant" as const };
      if ("error" in result) {
        logger.warn("Refresh failed: invalid_grant");
        return c.json({ error: "invalid_grant" }, 400);
      }
      return issued(result);
    }

    if (grantType !== "authorization_code") {
      logger.warn("Token exchange failed: unsupported grant type");
      return c.json({ error: "unsupported_grant_type" }, 400);
    }

    const code = body.code as string;
    const codeVerifier = body.code_verifier as string;
    const redirectUri = body.redirect_uri as string;

    const authCodeData = code ? await oauthStore.takeAuthCode(code) : null;
    if (!authCodeData) {
      logger.warn("Token exchange failed: invalid authorization code");
      return c.json({ error: "invalid_grant" }, 400);
    }

    logger.info("Processing token exchange request");

    if (redirectUri !== authCodeData.redirectUri) {
      logger.warn("Token exchange failed: redirect_uri mismatch");
      return c.json({ error: "invalid_grant", error_description: "redirect_uri does not match authorization request" }, 400);
    }

    if (clientId !== authCodeData.clientId) {
      logger.warn("Token exchange failed: client_id mismatch");
      return c.json({ error: "invalid_grant", error_description: "client_id does not match authorization request" }, 400);
    }

    if (authCodeData.codeChallenge) {
      if (!codeVerifier) {
        logger.warn("PKCE validation failed: missing code_verifier");
        return c.json({ error: "invalid_request", error_description: "code_verifier required" }, 400);
      }

      if (pkceS256(codeVerifier) !== authCodeData.codeChallenge) {
        logger.warn("PKCE validation failed: invalid code_verifier");
        return c.json({ error: "invalid_grant", error_description: "invalid code_verifier" }, 400);
      }
    }

    const { grantId } = await tokenStore.createGrant({
      email: authCodeData.email,
      clientId: authCodeData.clientId,
      encGoogleAccess: authCodeData.encGoogleAccess,
      encGoogleRefresh: authCodeData.encGoogleRefresh,
      googleExpiresAt: authCodeData.googleExpiresAt,
    });
    logger.info("Token exchange completed successfully");
    return issued(await tokenStore.issuePair(grantId, authCodeData.clientId));
    }
  );

  return oauth;
}
