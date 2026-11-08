// Token model (§5.3): rotation, reuse detection, expiry, Google refresh on call.
import { describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../support/test-server.ts";
import { login, refresh, type TokenResponse } from "../support/oauth-driver.ts";
import { callTool, mcp } from "../support/mcp-client.ts";
import { StaticCipher } from "../../src/crypto/static.ts";
import type { TokenCipher } from "../../src/crypto/cipher.ts";
import { PLANTED_KEY_MATERIAL } from "../support/planted.ts";
import { dumpStore } from "../support/store-dump.ts";

const MIN = 60_000;

async function setup(overrides: Parameters<typeof startTestServer>[0] = {}) {
  const s = await startTestServer(overrides);
  const l = await login(s.app, s.google);
  return { s, clientId: l.clientId, tokens: l.tokens };
}

async function works(s: TestServer, accessToken: string) {
  return (await mcp(s.app, accessToken, "tools/list")).status === 200;
}

async function rotate(s: TestServer, clientId: string, rt: string) {
  const r = await refresh(s.app, clientId, rt);
  return { status: r.status, body: (await r.json()) as TokenResponse & { error?: string } };
}

describe("refresh", () => {
  it("refresh_rotation", async () => {
    const { s, clientId, tokens } = await setup();
    const r = await rotate(s, clientId, tokens.refresh_token!);
    expect(r.status).toBe(200);
    expect(r.body.expires_in).toBe(3600);
    expect(r.body.refresh_token).not.toBe(tokens.refresh_token);
    expect(r.body.access_token).not.toBe(tokens.access_token);
    expect(await works(s, r.body.access_token)).toBe(true);
    s.clock.advance(2 * MIN);
    expect((await rotate(s, clientId, tokens.refresh_token!)).body.error).toBe("invalid_grant");
  });

  it("refresh_wrong_client", async () => {
    const { s, clientId, tokens } = await setup();
    const other = await login(s.app, s.google);
    const r = await rotate(s, other.clientId, tokens.refresh_token!);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_grant");
    const ok = await rotate(s, clientId, tokens.refresh_token!);
    expect(ok.status).toBe(200);
  });

  it("refresh_reuse_in_grace", async () => {
    const { s, clientId, tokens } = await setup();
    const fresh = await rotate(s, clientId, tokens.refresh_token!);
    s.clock.advance(59_000);
    const reuse = await rotate(s, clientId, tokens.refresh_token!);
    expect(reuse.body.error).toBe("invalid_grant");
    expect(await works(s, fresh.body.access_token)).toBe(true);
  });

  it("refresh_reuse_after_grace", async () => {
    const { s, clientId, tokens } = await setup();
    const fresh = await rotate(s, clientId, tokens.refresh_token!);
    s.clock.advance(61_000);
    const reuse = await rotate(s, clientId, tokens.refresh_token!);
    expect(reuse.body.error).toBe("invalid_grant");
    expect(await works(s, fresh.body.access_token)).toBe(false);
    expect((await rotate(s, clientId, fresh.body.refresh_token!)).body.error).toBe("invalid_grant");
  });

  it("refresh_concurrent", async () => {
    const { s, clientId, tokens } = await setup();
    const both = await Promise.all([rotate(s, clientId, tokens.refresh_token!), rotate(s, clientId, tokens.refresh_token!)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 400]);
    const winner = both.find((r) => r.status === 200)!;
    expect(await works(s, winner.body.access_token)).toBe(true);
  });

  it("access_token_expiry", async () => {
    const { s, clientId, tokens } = await setup();
    s.clock.advance(61 * MIN);
    const r = await mcp(s.app, tokens.access_token, "tools/list");
    expect(r.status).toBe(401);
    const fresh = await rotate(s, clientId, tokens.refresh_token!);
    expect(fresh.status).toBe(200);
    expect(await works(s, fresh.body.access_token)).toBe(true);
  });

  it("unsupported_grant_type", async () => {
    const { s } = await setup();
    const r = await s.app.fetch(
      new Request("http://localhost:3000/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=password&username=a&password=b",
      }),
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("unsupported_grant_type");
  });
});

describe("Google token on call", () => {
  // Google's token lives 3599 s; we refresh 60 s early. Our access token lives 3600 s.
  const PAST_GOOGLE_REFRESH_POINT = 3550 * 1000;

  it("google_token_refresh_on_call", async () => {
    const { s, tokens } = await setup();
    s.clock.advance(PAST_GOOGLE_REFRESH_POINT);
    s.google.queue("token.refresh.ok");
    s.google.queue("tasklists.list.ok");
    const r = await callTool(s.app, tokens.access_token, "list_task_lists", {});
    expect(r.result.isError).toBeFalsy();
    expect(s.google.calls.at(-1)!.headers.get("authorization")).toBe("Bearer PLANTED_GOOGLE_ACCESS_A_REFRESHED");
  });

  it("google_invalid_grant", async () => {
    const { s, tokens } = await setup();
    s.clock.advance(PAST_GOOGLE_REFRESH_POINT);
    s.google.queue("token.refresh.invalid_grant");
    const r = await callTool(s.app, tokens.access_token, "list_task_lists", {});
    expect(r.status).toBe(401);
    expect((await dumpStore(s.deps.store)).filter((e) => e.key[0] === "grants")).toEqual([]);
  });

  it("google_token_cached", async () => {
    let decrypts = 0;
    const real = new StaticCipher(PLANTED_KEY_MATERIAL);
    // Test double of our own interface (counts calls), not a mock of src/.
    const counting: TokenCipher = {
      encrypt: (p) => real.encrypt(p),
      decrypt: (c) => {
        decrypts++;
        return real.decrypt(c);
      },
    };
    const { s, tokens } = await setup({ cipher: counting });
    s.google.queue("tasklists.list.ok");
    s.google.queue("tasklists.list.ok");
    await callTool(s.app, tokens.access_token, "list_task_lists", {});
    s.clock.advance(4 * MIN);
    await callTool(s.app, tokens.access_token, "list_task_lists", {});
    expect(decrypts).toBe(1);
  });
});
