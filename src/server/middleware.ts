import { Context, Next } from "hono";
import type { TokenStore } from "../auth/token-store.ts";
import type { AppDeps } from "../deps.ts";
import { resourceMetadataUrl } from "../auth/issuer.ts";
import { GrantRevokedError, type GoogleTokenProvider } from "../google/client.ts";
import { BackendUnavailableError } from "../store/store.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger({ component: "middleware" });

export function authenticateBearer(deps: Pick<AppDeps, "config">, tokenStore: TokenStore, google: GoogleTokenProvider) {
  // MCP auth spec: every 401 points the client at the protected-resource metadata.
  const challenge = (c: Context) => {
    c.header("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl(deps, c.req.raw)}"`);
  };
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn("Authentication failed: missing or invalid Authorization header");
      challenge(c);
      return c.json(
        {
          error: "unauthorized",
          error_description: "Missing or invalid Authorization header",
        },
        401
      );
    }

    const token = authHeader.substring(7);

    const resolved = await tokenStore.resolveAccess(token);
    let revoked = !resolved;
    if (resolved) {
      // Refresh Google's token up front, so a grant Google has revoked answers
      // 401 (client re-authorizes) instead of a tool error. Other failures are
      // left for the tool call to report.
      try {
        await google.accessTokenFor(resolved.grantId);
      } catch (error) {
        if (error instanceof GrantRevokedError) revoked = true;
        else if (error instanceof BackendUnavailableError) throw error; // → 503
      }
    }
    if (revoked) {
      logger.warn("Authentication failed: invalid or expired token");
      challenge(c);
      return c.json(
        {
          error: "unauthorized",
          error_description: "Invalid or expired access token",
        },
        401
      );
    }

    c.set("grantId", resolved!.grantId);

    await next();
  };
}
