// ALLOWED_DOMAIN (AC3). Oracle: planted truth (rank 1) — each id_token's claims
// are planted, so the right answer is known.
import { describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../support/test-server.ts";
import { authorize, exchange, register, req } from "../support/oauth-driver.ts";
import { exchangeWithIdToken } from "../support/id-token.ts";
import { dumpStore } from "../support/store-dump.ts";

async function callbackWith(s: TestServer, claims: Record<string, unknown> | null) {
  const client = await register(s.app);
  const a = await authorize(s.app, client.clientId, client.redirectUri);
  const googleRedirect = new URL(a.headers.get("location")!);
  s.google.queue("token.exchange.ok", exchangeWithIdToken(claims));
  const cb = await req(s.app, `/callback?code=PLANTED_GOOGLE_CODE&state=${googleRedirect.searchParams.get("state")}`);
  return { client, googleRedirect, cb };
}

async function expectRejected(s: TestServer, cb: Response) {
  expect(cb.status).toBe(403);
  expect(cb.headers.get("content-type")).toMatch(/^text\/plain/);
  expect(cb.headers.get("location")).toBeNull();
  const kept = (await dumpStore(s.deps.store)).filter((e) => ["auth_codes", "grants", "grants_by_email"].includes(e.key[0]));
  expect(kept).toEqual([]);
}

describe("ALLOWED_DOMAIN", () => {
  const env = { ALLOWED_DOMAIN: "example.com" };

  it("wrong_domain", async () => {
    const s = await startTestServer({ env });
    const { googleRedirect, cb } = await callbackWith(s, { email: "eve@gmail.com", email_verified: true, hd: "gmail.com" });
    expect(googleRedirect.searchParams.get("hd")).toBe("example.com");
    await expectRejected(s, cb);
  });

  it("unverified_email", async () => {
    const s = await startTestServer({ env });
    const { cb } = await callbackWith(s, { email: "a@example.com", email_verified: false, hd: "example.com" });
    await expectRejected(s, cb);
  });

  it("id_token_without_hd", async () => {
    const s = await startTestServer({ env });
    const { cb } = await callbackWith(s, { email: "eve@gmail.com", email_verified: true });
    await expectRejected(s, cb);
  });

  it("missing_id_token", async () => {
    const s = await startTestServer({ env });
    const { cb } = await callbackWith(s, null);
    await expectRejected(s, cb);
  });

  it("allowed_domain_logs_in", async () => {
    const s = await startTestServer({ env });
    const { client, cb } = await callbackWith(s, { email: "A@Example.com", email_verified: true, hd: "example.com" });
    expect(cb.status).toBe(302);
    const code = new URL(cb.headers.get("location")!).searchParams.get("code")!;
    expect((await exchange(s.app, client, code)).status).toBe(200);
    const byEmail = (await dumpStore(s.deps.store)).filter((e) => e.key[0] === "grants_by_email");
    expect(byEmail.map((e) => e.key[1])).toEqual(["a@example.com"]);
  });

  it("domain_unset_open", async () => {
    const s = await startTestServer();
    const { client, googleRedirect, cb } = await callbackWith(s, { email: "eve@gmail.com", email_verified: true });
    expect(googleRedirect.searchParams.has("hd")).toBe(false);
    expect(cb.status).toBe(302);
    const code = new URL(cb.headers.get("location")!).searchParams.get("code")!;
    expect((await exchange(s.app, client, code)).status).toBe(200);
  });

  it("error_params_not_echoed", async () => {
    const s = await startTestServer({ env });
    const r = await req(s.app, `/callback?error=${encodeURIComponent("<script>alert(1)</script>")}&state=x`);
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain("<script>");
  });
});
