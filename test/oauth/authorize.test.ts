// Boundary handler: /authorize, /callback, /token (authorization_code).
import { describe, expect, it } from "vitest";
import { startTestServer } from "../support/test-server.ts";
import { authorize, authorizeAndCallback, exchange, register } from "../support/oauth-driver.ts";
import { mcp } from "../support/mcp-client.ts";

describe("authorize", () => {
  it("unregistered_redirect_uri", async () => {
    const s = await startTestServer();
    const client = await register(s.app, "http://localhost:9999/callback");
    const r = await authorize(s.app, client.clientId, "https://evil.example/steal");
    expect(r.status).toBe(400);
    expect(r.headers.get("location")).toBeNull();
    expect((await r.json()).error).toBe("invalid_request");
  });

  it("unknown_client_id", async () => {
    const s = await startTestServer();
    const r = await authorize(s.app, "no-such-client", "http://localhost:9999/callback");
    expect(r.status).toBe(400);
    expect(r.headers.get("location")).toBeNull();
    expect((await r.json()).error).toBe("invalid_client");
  });

  it("missing_client_id", async () => {
    const s = await startTestServer();
    const r = await authorize(s.app, "", "http://localhost:9999/callback");
    expect(r.status).toBe(400);
    expect(r.headers.get("location")).toBeNull();
  });

  it("pkce_mismatch", async () => {
    const s = await startTestServer();
    const client = await register(s.app);
    const { code } = await authorizeAndCallback(s.app, s.google, client);
    const r = await exchange(s.app, client, code, "wrong-verifier-wrong-verifier-wrong-verifier");
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("invalid_grant");
    expect(body.access_token).toBeUndefined();
  });

  it("auth_code_replay", async () => {
    const s = await startTestServer();
    const client = await register(s.app);
    const { code } = await authorizeAndCallback(s.app, s.google, client);
    expect((await exchange(s.app, client, code)).status).toBe(200);
    const again = await exchange(s.app, client, code);
    expect(again.status).toBe(400);
    expect((await again.json()).error).toBe("invalid_grant");
  });

  it("auth_code_concurrent_redeem", async () => {
    const s = await startTestServer();
    const client = await register(s.app);
    const { code } = await authorizeAndCallback(s.app, s.google, client);
    const results = await Promise.all([exchange(s.app, client, code), exchange(s.app, client, code)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it("login_across_instances", async () => {
    const a = await startTestServer();
    const b = await startTestServer({ store: a.deps.store, clock: a.clock, google: a.google });
    const client = await register(a.app);
    const { code } = await authorizeAndCallback(a.app, a.google, client, { callbackApp: b.app });
    const t = await exchange(b.app, client, code);
    expect(t.status).toBe(200);
    const { access_token } = await t.json();
    const r = await mcp(a.app, access_token, "tools/list");
    expect(r.messages[0].result.tools).toHaveLength(14);
  });
});
