import type { AppDeps } from "../deps.ts";

export interface OAuthSession {
  state: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  redirectUri: string;
  clientId?: string;
}

/** Issued at /callback after Google's code exchange; redeemed once at /token. */
export interface AuthCode {
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  email?: string;
  encGoogleAccess: string;
  encGoogleRefresh: string;
  googleExpiresAt: number;
}

export interface RegisteredClient {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
}

const TEN_MINUTES = 600000;

export type OAuthStore = ReturnType<typeof createOAuthStore>;

export function createOAuthStore(deps: Pick<AppDeps, "store">) {
  const { store } = deps;
  return {
    storeSession: (sessionId: string, session: OAuthSession) =>
      store.set(["oauth_sessions", sessionId], session, { ttlMs: TEN_MINUTES }),
    getSession: (sessionId: string) => store.get<OAuthSession>(["oauth_sessions", sessionId]),
    deleteSession: (sessionId: string) => store.delete(["oauth_sessions", sessionId]),
    storeAuthCode: (code: string, data: AuthCode) => store.set(["auth_codes", code], data, { ttlMs: TEN_MINUTES }),
    /** single use: the first caller gets the code, every later caller null */
    takeAuthCode: (code: string) => store.take<AuthCode>(["auth_codes", code]),
    registerClient: (clientId: string, client: RegisteredClient) => store.set(["clients", clientId], client),
    getClient: (clientId: string) => store.get<RegisteredClient>(["clients", clientId]),
  };
}
