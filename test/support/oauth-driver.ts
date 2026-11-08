// Drives the OAuth flow a real MCP client performs, entirely through app.fetch.
import type { GoogleFake } from "./google-fake.ts";

export type FetchApp = { fetch(req: Request): Response | Promise<Response> };
type QueueOverrides = Parameters<GoogleFake["queue"]>[1];

export const BASE = "http://localhost:3000";
// RFC 7636 Appendix B.
export const PKCE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
export const PKCE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

export type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; token_type: string };
export type Client = { clientId: string; redirectUri: string };

export async function req(
  app: FetchApp,
  path: string,
  init?: RequestInit & { form?: Record<string, string> },
): Promise<Response> {
  const { form, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);
  let body = rest.body;
  if (form) {
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(form).toString();
  }
  return await app.fetch(new Request(`${BASE}${path}`, { ...rest, headers, body }));
}

export async function register(app: FetchApp, redirectUri = "http://localhost:9999/callback"): Promise<Client> {
  const res = await req(app, "/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "test" }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status}`);
  const j = (await res.json()) as { client_id: string };
  return { clientId: j.client_id, redirectUri };
}

export async function authorize(app: FetchApp, clientId: string, redirectUri: string, state = "client-state"): Promise<Response> {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: PKCE_CHALLENGE,
    code_challenge_method: "S256",
  });
  return await req(app, `/authorize?${q}`);
}

// Returns the client-facing authorization code after the Google round trip.
export async function authorizeAndCallback(
  app: FetchApp,
  google: GoogleFake,
  client: Client,
  opts: { exchangeFixture?: string; exchangeOverrides?: QueueOverrides; callbackApp?: FetchApp } = {},
): Promise<{ code: string; state: string; googleRedirect: URL }> {
  const a = await authorize(app, client.clientId, client.redirectUri);
  if (a.status !== 302) throw new Error(`authorize failed: ${a.status} ${await a.text()}`);
  const googleRedirect = new URL(a.headers.get("location")!);
  const internalState = googleRedirect.searchParams.get("state")!;
  // Queued before the callback, so it is served whichever route exchanges the code.
  google.queue(opts.exchangeFixture ?? "token.exchange.ok", opts.exchangeOverrides);
  const cb = await req(opts.callbackApp ?? app, `/callback?code=PLANTED_GOOGLE_CODE&state=${internalState}`);
  if (cb.status !== 302) throw new Error(`callback failed: ${cb.status} ${await cb.text()}`);
  const back = new URL(cb.headers.get("location")!);
  return { code: back.searchParams.get("code")!, state: back.searchParams.get("state")!, googleRedirect };
}

export async function exchange(app: FetchApp, client: Client, code: string, verifier = PKCE_VERIFIER): Promise<Response> {
  return await req(app, "/token", {
    method: "POST",
    form: {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: client.redirectUri,
      client_id: client.clientId,
    },
  });
}

export async function refresh(app: FetchApp, clientId: string, refreshToken: string): Promise<Response> {
  return await req(app, "/token", {
    method: "POST",
    form: { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId },
  });
}

export async function login(
  app: FetchApp,
  google: GoogleFake,
  opts: { exchangeFixture?: string; exchangeOverrides?: QueueOverrides } = {},
): Promise<Client & { tokens: TokenResponse }> {
  const client = await register(app);
  const { code } = await authorizeAndCallback(app, google, client, opts);
  const t = await exchange(app, client, code);
  if (!t.ok) throw new Error(`token failed: ${t.status} ${await t.text()}`);
  return { ...client, tokens: (await t.json()) as TokenResponse };
}
