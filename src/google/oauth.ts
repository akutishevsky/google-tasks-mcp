// Google's OAuth token endpoints: code exchange, refresh, revoke.
import type { AppDeps } from "../deps.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger({ component: "google-oauth" });

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** Google says the refresh token is no longer valid (revoked, expired, user removed). */
export class GoogleInvalidGrantError extends Error {
  constructor() {
    super("Google refresh token is no longer valid");
    this.name = "GoogleInvalidGrantError";
  }
}

type Deps = Pick<AppDeps, "config" | "fetch">;

async function postForm(deps: Deps, url: string, form: Record<string, string>): Promise<Response> {
  return await deps.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
}

export async function exchangeCode(
  deps: Deps,
  code: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; idToken?: string }> {
  const { clientId, clientSecret, redirectUri } = deps.config.google;
  const res = await postForm(deps, GOOGLE_TOKEN_URL, {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const data = await res.json();
  if (!res.ok) {
    logger.error("Google token exchange failed", { status: res.status });
    throw new Error("Failed to exchange Google authorization code");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    idToken: data.id_token,
  };
}

export async function refreshGoogleToken(
  deps: Deps,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  logger.info("Refreshing Google access token");
  const { clientId, clientSecret } = deps.config.google;
  const res = await postForm(deps, GOOGLE_TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const data = await res.json();
  if (!res.ok) {
    logger.error("Google token refresh failed", { status: res.status });
    if (data?.error === "invalid_grant") throw new GoogleInvalidGrantError();
    throw new Error(`Failed to refresh Google token: ${data?.error}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in,
  };
}

export async function revokeGoogleToken(deps: Deps, token: string): Promise<void> {
  const res = await postForm(deps, GOOGLE_REVOKE_URL, { token });
  if (!res.ok) {
    logger.warn("Google token revoke failed", { status: res.status });
    throw new Error(`Google revoke failed: ${res.status}`);
  }
}
