// Kill switch (AC5). Oracle: planted truth — users and their tokens are planted.
import { describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../support/test-server.ts";
import { login } from "../support/oauth-driver.ts";
import { mcp } from "../support/mcp-client.ts";
import { loadFixture } from "../support/google-fake.ts";
import { plantedIdToken } from "../support/id-token.ts";
import { runRevoke } from "../../src/cli/revoke.ts";

async function loginAs(s: TestServer, user: "A" | "B" | "C") {
  const email = `${user.toLowerCase()}@example.com`;
  const body = {
    ...(loadFixture("token.exchange.ok").response.body as Record<string, unknown>),
    access_token: `PLANTED_GOOGLE_ACCESS_${user}`,
    refresh_token: `PLANTED_GOOGLE_REFRESH_${user}`,
    id_token: plantedIdToken({ email, email_verified: true, hd: "example.com" }),
  };
  return (await login(s.app, s.google, { exchangeOverrides: { body } })).tokens.access_token;
}

const status = async (s: TestServer, token: string) => (await mcp(s.app, token, "tools/list")).status;
const revokeCalls = (s: TestServer) =>
  s.google.calls.filter((c) => c.url.pathname === "/revoke").map((c) => new URLSearchParams(c.body).get("token"));

describe("revoke", () => {
  it("revoke_one_user", async () => {
    const s = await startTestServer();
    const a = await loginAs(s, "A");
    const b = await loginAs(s, "B");
    s.google.queue("token.revoke.ok");
    const out: string[] = [];
    const n = await runRevoke(s.deps, { email: "A@example.com" }, (l) => out.push(l));
    expect(n).toBe(1);
    expect(out.at(-1)).toBe("revoked 1");
    expect(await status(s, a)).toBe(401);
    expect(await status(s, b)).toBe(200);
    expect(revokeCalls(s)).toEqual(["PLANTED_GOOGLE_REFRESH_A"]);
  });

  it("revoke_all", async () => {
    const s = await startTestServer();
    const tokens = [await loginAs(s, "A"), await loginAs(s, "B"), await loginAs(s, "C")];
    for (let i = 0; i < 3; i++) s.google.queue("token.revoke.ok");
    const out: string[] = [];
    expect(await runRevoke(s.deps, { all: true }, (l) => out.push(l))).toBe(3);
    expect(out.at(-1)).toBe("revoked 3");
    for (const t of tokens) expect(await status(s, t)).toBe(401);
    expect(revokeCalls(s).sort()).toEqual(["PLANTED_GOOGLE_REFRESH_A", "PLANTED_GOOGLE_REFRESH_B", "PLANTED_GOOGLE_REFRESH_C"]);
  });

  it("dry_run_changes_nothing", async () => {
    const s = await startTestServer();
    const a = await loginAs(s, "A");
    const out: string[] = [];
    expect(await runRevoke(s.deps, { all: true, dryRun: true }, (l) => out.push(l))).toBe(1);
    expect(out.at(-1)).toBe("would revoke 1 (dry run)");
    expect(out.join("\n")).toContain("a@example.com");
    expect(await status(s, a)).toBe(200);
    expect(revokeCalls(s)).toEqual([]);
  });

  it("google_revoke_failure_still_deletes", async () => {
    const s = await startTestServer();
    const a = await loginAs(s, "A");
    s.google.queue("token.revoke.ok", { status: 400, body: { error: "invalid_token" } });
    expect(await runRevoke(s.deps, { email: "a@example.com" }, () => {})).toBe(1);
    expect(await status(s, a)).toBe(401);
  });

  it("unknown_email_revokes_nothing", async () => {
    const s = await startTestServer();
    await loginAs(s, "A");
    const out: string[] = [];
    expect(await runRevoke(s.deps, { email: "nobody@example.com" }, (l) => out.push(l))).toBe(0);
    expect(out.at(-1)).toBe("revoked 0");
  });
});

describe("revoke arguments", () => {
  it("requires_exactly_one_target", async () => {
    const { parseRevokeArgs } = await import("../../src/cli/revoke.ts");
    expect(parseRevokeArgs([])).toBeNull();
    expect(parseRevokeArgs(["--all", "--email", "a@example.com"])).toBeNull();
    expect(parseRevokeArgs(["--email"])).toBeNull();
    expect(parseRevokeArgs(["--bogus"])).toBeNull();
    expect(parseRevokeArgs(["--email", "a@example.com", "--dry-run"])).toEqual({ email: "a@example.com", dryRun: true });
    expect(parseRevokeArgs(["--all"])).toEqual({ all: true });
  });
});
