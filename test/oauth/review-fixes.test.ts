// Findings from the final review, each pinned by a scenario.
import { describe, expect, it } from "vitest";
import { startTestServer } from "../support/test-server.ts";
import { authorize, authorizeAndCallback, register, req, PKCE_CHALLENGE } from "../support/oauth-driver.ts";
import { exchange } from "../support/oauth-driver.ts";
import { createTokenStore } from "../../src/auth/token-store.ts";
import type { Store } from "../../src/store/store.ts";

const registerRaw = (s: Awaited<ReturnType<typeof startTestServer>>, body: string) =>
  req(s.app, "/register", { method: "POST", headers: { "Content-Type": "application/json" }, body });

describe("/register validation (review #4)", () => {
  it("register_rejects_malformed_metadata", async () => {
    const s = await startTestServer();
    for (const body of [
      "{not json",
      JSON.stringify({ redirect_uris: "https://a.example/cb" }),
      JSON.stringify({ redirect_uris: [] }),
      JSON.stringify({}),
      JSON.stringify({ redirect_uris: ["/relative/cb"] }),
      JSON.stringify({ redirect_uris: ["javascript:alert(1)"] }),
      JSON.stringify({ redirect_uris: ["http://a.example/cb"] }),
      JSON.stringify({ redirect_uris: [42] }),
    ]) {
      const r = await registerRaw(s, body);
      expect(r.status, body).toBe(400);
      expect((await r.json()).error, body).toBe("invalid_client_metadata");
    }
  });

  it("register_accepts_https_and_loopback", async () => {
    const s = await startTestServer();
    for (const uri of ["https://a.example/cb", "http://localhost:8765/callback", "http://127.0.0.1:33418/", "http://[::1]:5000/cb"]) {
      const r = await registerRaw(s, JSON.stringify({ redirect_uris: [uri] }));
      expect(r.status, uri).toBe(200);
    }
  });

  it("string_redirect_uris_cannot_substring_match", async () => {
    const s = await startTestServer();
    await registerRaw(s, JSON.stringify({ redirect_uris: "https://a.example/cb" }));
    const ok = await register(s.app, "https://a.example/cb");
    const r = await authorize(s.app, ok.clientId, "https://a.example");
    expect(r.status).toBe(400);
  });
});

describe("PKCE and client binding (review #5)", () => {
  it("authorize_requires_pkce_s256", async () => {
    const s = await startTestServer();
    const c = await register(s.app);
    const base = { response_type: "code", client_id: c.clientId, redirect_uri: c.redirectUri, state: "s" };
    const noPkce = await req(s.app, `/authorize?${new URLSearchParams(base)}`);
    expect(noPkce.status).toBe(400);
    expect(noPkce.headers.get("location")).toBeNull();
    const plain = await req(
      s.app,
      `/authorize?${new URLSearchParams({ ...base, code_challenge: PKCE_CHALLENGE, code_challenge_method: "plain" })}`,
    );
    expect(plain.status).toBe(400);
    expect(plain.headers.get("location")).toBeNull();
  });

  it("token_requires_client_id", async () => {
    const s = await startTestServer();
    const c = await register(s.app);
    const { code } = await authorizeAndCallback(s.app, s.google, c);
    const r = await exchange(s.app, { ...c, clientId: "" }, code);
    expect(r.status).toBe(400);
  });
});

describe("ALLOWED_REDIRECT_URIS (review #1: phishing via open registration)", () => {
  const env = { ALLOWED_REDIRECT_URIS: "loopback,https://claude.ai/api/mcp/auth_callback" };

  it("register_rejects_unlisted_redirect", async () => {
    const s = await startTestServer({ env });
    const r = await registerRaw(s, JSON.stringify({ redirect_uris: ["https://attacker.example/cb"] }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("invalid_redirect_uri");
  });

  it("register_accepts_listed_redirects", async () => {
    const s = await startTestServer({ env });
    for (const uri of ["https://claude.ai/api/mcp/auth_callback", "http://localhost:51234/callback", "http://127.0.0.1:9/x"]) {
      expect((await registerRaw(s, JSON.stringify({ redirect_uris: [uri] }))).status, uri).toBe(200);
    }
  });

  it("loopback_entry_rejects_userinfo_tricks", async () => {
    const s = await startTestServer({ env });
    const r = await registerRaw(s, JSON.stringify({ redirect_uris: ["http://localhost:80@attacker.example/cb"] }));
    expect(r.status).toBe(400);
  });

  it("phishing_link_never_delivers_code", async () => {
    // Client registered before the allowlist was configured (shared store).
    const open = await startTestServer();
    const evil = await register(open.app, "https://attacker.example/cb");
    const locked = await startTestServer({ env, store: open.deps.store, clock: open.clock, google: open.google });
    const r = await authorize(locked.app, evil.clientId, evil.redirectUri);
    expect(r.status).toBe(400);
    expect(r.headers.get("location")).toBeNull();
  });
});

describe("revoke cannot be undone by a racing write (review #2)", () => {
  it("revoke_during_rotate_stays_revoked", async () => {
    const s = await startTestServer();
    const base = s.deps.store;
    let pause: (() => Promise<void>) | null = null;
    // Interleaves a revoke between rotateRefresh's grant read and its write.
    const racing: Store = {
      ...base,
      get: base.get.bind(base),
      take: base.take.bind(base),
      delete: base.delete.bind(base),
      list: base.list.bind(base),
      close: base.close.bind(base),
      set: async (key, value, opts) => {
        if (key[0] === "grants" && pause) {
          const p = pause;
          pause = null;
          await p();
        }
        return base.set(key, value, opts);
      },
    };
    const tokens = createTokenStore({ ...s.deps, store: racing });
    const { grantId } = await tokens.createGrant({
      email: "a@example.com",
      clientId: "c1",
      encGoogleAccess: await s.deps.cipher.encrypt("PLANTED_GOOGLE_ACCESS_A"),
      encGoogleRefresh: await s.deps.cipher.encrypt("PLANTED_GOOGLE_REFRESH_A"),
      googleExpiresAt: s.clock.now() + 3_600_000,
    });
    const pair = await tokens.issuePair(grantId, "c1");
    pause = () => tokens.revokeGrant(grantId);
    const rotated = await tokens.rotateRefresh(pair.refreshToken, "c1");
    expect(await tokens.getGrant(grantId)).toBeNull();
    expect(await tokens.listGrants("a@example.com")).toEqual([]);
    if (!("error" in rotated)) expect(await tokens.resolveAccess(rotated.accessToken)).toBeNull();
  });

  it("revoke_during_google_update_stays_revoked", async () => {
    const s = await startTestServer();
    const base = s.deps.store;
    let pause: (() => Promise<void>) | null = null;
    const racing: Store = {
      get: base.get.bind(base),
      take: base.take.bind(base),
      delete: base.delete.bind(base),
      list: base.list.bind(base),
      close: base.close.bind(base),
      set: async (key, value, opts) => {
        if (key[0] === "grants" && pause) {
          const p = pause;
          pause = null;
          await p();
        }
        return base.set(key, value, opts);
      },
    };
    const tokens = createTokenStore({ ...s.deps, store: racing });
    const { grantId } = await tokens.createGrant({
      clientId: "c1",
      encGoogleAccess: await s.deps.cipher.encrypt("PLANTED_GOOGLE_ACCESS_A"),
      encGoogleRefresh: await s.deps.cipher.encrypt("PLANTED_GOOGLE_REFRESH_A"),
      googleExpiresAt: s.clock.now(),
    });
    pause = () => tokens.revokeGrant(grantId);
    await tokens.updateGoogleTokens(grantId, { accessToken: "PLANTED_GOOGLE_ACCESS_A_REFRESHED", refreshToken: "PLANTED_GOOGLE_REFRESH_A", expiresIn: 3599 });
    expect(await tokens.getGrant(grantId)).toBeNull();
  });
});
