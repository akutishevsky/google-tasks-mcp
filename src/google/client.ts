import type { AppDeps } from "../deps.ts";
import type { TokenStore } from "../auth/token-store.ts";
import { GoogleInvalidGrantError, refreshGoogleToken } from "./oauth.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger({ component: "google-client" });

/** What the Tasks API functions need: a valid Google access token and a fetch. */
export interface GoogleClient {
  getAccessToken(): Promise<string>;
  fetch: typeof fetch;
}

/** The grant is gone (revoked, or Google refused its refresh token). */
export class GrantRevokedError extends Error {
  constructor() {
    super("Grant revoked");
    this.name = "GrantRevokedError";
  }
}

const REFRESH_EARLY_MS = 60 * 1000;
const CACHE_MAX_MS = 5 * 60 * 1000;

export type GoogleTokenProvider = ReturnType<typeof createGoogleTokenProvider>;

/**
 * One per app. Decrypted Google access tokens are cached in memory per grant
 * until min(5 min, Google expiry − 60 s), so a hot path makes no cipher call.
 */
export function createGoogleTokenProvider(deps: AppDeps, tokenStore: TokenStore) {
  const cache = new Map<string, { token: string; until: number }>();

  async function accessTokenFor(grantId: string): Promise<string> {
    const now = deps.clock();
    const hit = cache.get(grantId);
    if (hit && hit.until > now) return hit.token;
    cache.delete(grantId);

    const grant = await tokenStore.getGrant(grantId);
    if (!grant) throw new GrantRevokedError();

    let token: string;
    let googleExpiresAt = grant.googleExpiresAt;
    if (now >= grant.googleExpiresAt - REFRESH_EARLY_MS) {
      logger.info("Google access token expiring, refreshing");
      try {
        const refreshed = await refreshGoogleToken(deps, await deps.cipher.decrypt(grant.encGoogleRefresh));
        await tokenStore.updateGoogleTokens(grantId, refreshed);
        token = refreshed.accessToken;
        googleExpiresAt = deps.clock() + refreshed.expiresIn * 1000;
      } catch (error) {
        if (error instanceof GoogleInvalidGrantError) {
          logger.warn("Google refused the refresh token; revoking grant");
          await tokenStore.revokeGrant(grantId);
          throw new GrantRevokedError();
        }
        throw error;
      }
    } else {
      token = await deps.cipher.decrypt(grant.encGoogleAccess);
    }
    cache.set(grantId, { token, until: Math.min(now + CACHE_MAX_MS, googleExpiresAt - REFRESH_EARLY_MS) });
    return token;
  }

  return {
    accessTokenFor,
    clientFor(grantId: string): GoogleClient {
      return { fetch: deps.fetch, getAccessToken: () => accessTokenFor(grantId) };
    },
  };
}
