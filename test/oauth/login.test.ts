// Boundary handler: full login as a client performs it (§11.4 full_login).
import { describe, expect, it } from "vitest";
import { startTestServer } from "../support/test-server.ts";
import { authorize, exchange, register, req } from "../support/oauth-driver.ts";
import { mcp } from "../support/mcp-client.ts";
import { dumpStore } from "../support/store-dump.ts";

describe("login", () => {
  it("full_login", async () => {
    const s = await startTestServer();
    const client = await register(s.app);

    const a = await authorize(s.app, client.clientId, client.redirectUri, "orig-state");
    expect(a.status).toBe(302);
    const g = new URL(a.headers.get("location")!);
    expect(g.origin + g.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(g.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/tasks");
    expect(g.searchParams.get("access_type")).toBe("offline");
    expect(g.searchParams.get("prompt")).toBe("consent");

    s.google.queue("token.exchange.ok");
    const cb = await req(s.app, `/callback?code=PLANTED_GOOGLE_CODE&state=${g.searchParams.get("state")}`);
    expect(cb.status).toBe(302);
    const back = new URL(cb.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(client.redirectUri);
    expect(back.searchParams.get("state")).toBe("orig-state");
    expect(s.google.pending()).toBe(0); // Google code exchanged at the callback

    const t = await exchange(s.app, client, back.searchParams.get("code")!);
    expect(t.status).toBe(200);
    const tokens = await t.json();
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBe(3600);
    expect(typeof tokens.access_token).toBe("string");
    expect(typeof tokens.refresh_token).toBe("string");
    expect(tokens.access_token).not.toBe(tokens.refresh_token);

    const list = await mcp(s.app, tokens.access_token, "tools/list");
    expect(list.messages[0].result.tools).toHaveLength(14);
  });

  it("store_holds_no_raw_tokens", async () => {
    const s = await startTestServer();
    const client = await register(s.app);
    const a = await authorize(s.app, client.clientId, client.redirectUri);
    const state = new URL(a.headers.get("location")!).searchParams.get("state");
    s.google.queue("token.exchange.ok");
    const cb = await req(s.app, `/callback?code=PLANTED_GOOGLE_CODE&state=${state}`);
    const code = new URL(cb.headers.get("location")!).searchParams.get("code")!;
    const tokens = await (await exchange(s.app, client, code)).json();

    const dump = JSON.stringify(await dumpStore(s.deps.store));
    for (const secret of [tokens.access_token, tokens.refresh_token, "PLANTED_GOOGLE_ACCESS_A", "PLANTED_GOOGLE_REFRESH_A"]) {
      expect(dump).not.toContain(secret);
    }
  });

  it("google_exchange_failure_is_not_500", async () => {
    const s = await startTestServer();
    const client = await register(s.app);
    const a = await authorize(s.app, client.clientId, client.redirectUri);
    const state = new URL(a.headers.get("location")!).searchParams.get("state");
    s.google.queue("token.exchange.err");
    const cb = await req(s.app, `/callback?code=PLANTED_GOOGLE_CODE&state=${state}`);
    expect(cb.status).toBe(502);
    expect(cb.headers.get("location")).toBeNull();
  });
});
