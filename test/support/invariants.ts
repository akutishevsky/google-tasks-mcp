// Cross-cutting security invariants (§11.8), checked after every test against
// every server startTestServer built during it.
import { expect } from "vitest";
import type { Store } from "../../src/store/store.ts";
import { dumpStore } from "./store-dump.ts";

export type RecordedResponse = { path: string; status: number; headers: Headers; body: string; issuesTokens: boolean };

export type ServerRecord = {
  store: Store;
  responses: RecordedResponse[];
  secrets: Set<string>;
};

// Google tokens planted by fixtures and tests. Any value matching this is a secret.
const PLANTED_GOOGLE_TOKEN = /PLANTED_GOOGLE_(ACCESS|REFRESH)_[A-Z0-9_]+/g;

const servers: ServerRecord[] = [];
export const logs: string[] = [];

export function track(rec: ServerRecord): void {
  servers.push(rec);
}

export function takeTracked(): ServerRecord[] {
  return servers.splice(0, servers.length);
}

const SECURITY_HEADERS = ["x-content-type-options", "x-frame-options", "content-security-policy", "referrer-policy"];

export async function assertInvariants(recs: ServerRecord[], logLines: string[]): Promise<void> {
  const secrets = new Set<string>();
  for (const r of recs) for (const s of r.secrets) secrets.add(s);

  const seenStores = new Set<Store>();
  for (const rec of recs) {
    for (const res of rec.responses) {
      const where = `${res.status} ${res.path}`;
      // 5. no 500
      expect(res.status, `invariant 5 (no 500): ${where}`).not.toBe(500);
      // 4. security headers
      for (const h of SECURITY_HEADERS) expect(res.headers.get(h), `invariant 4 (${h}): ${where}`).not.toBeNull();
      // 3. every /mcp 401 carries resource_metadata
      if (res.status === 401 && res.path.startsWith("/mcp")) {
        expect(res.headers.get("www-authenticate") ?? "", `invariant 3: ${where}`).toContain("resource_metadata=");
      }
      // 1. no secret in any body, except the /token response that issues them
      if (!res.issuesTokens) {
        for (const s of secrets) expect(res.body.includes(s), `invariant 1 (body leaks a secret): ${where}`).toBe(false);
        for (const m of res.body.match(PLANTED_GOOGLE_TOKEN) ?? []) {
          expect.fail(`invariant 1 (body leaks Google token ${m}): ${where}`);
        }
      }
    }
    // 2. no raw secret anywhere in the store
    if (!seenStores.has(rec.store)) {
      seenStores.add(rec.store);
      let dump: string;
      try {
        dump = JSON.stringify(await dumpStore(rec.store));
      } catch {
        continue; // store closed by the test
      }
      for (const s of secrets) expect(dump.includes(s), "invariant 2 (store holds a raw secret)").toBe(false);
      expect(dump.match(PLANTED_GOOGLE_TOKEN), "invariant 2 (store holds a Google token)").toBeNull();
    }
  }
  // 1. no secret in any log line
  for (const line of logLines) {
    for (const s of secrets) expect(line.includes(s), `invariant 1 (log leaks a secret): ${line}`).toBe(false);
    expect(line.match(PLANTED_GOOGLE_TOKEN), `invariant 1 (log leaks a Google token): ${line}`).toBeNull();
  }
}

/** Wraps app.fetch to record responses and the tokens /token issues. */
export function recordingFetch(
  fetchFn: (req: Request) => Response | Promise<Response>,
  rec: ServerRecord,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const res = await fetchFn(req);
    const path = new URL(req.url).pathname;
    const body = await res.clone().text();
    let issuesTokens = false;
    if (path === "/token" && res.status === 200) {
      try {
        const j = JSON.parse(body);
        for (const k of ["access_token", "refresh_token"]) if (typeof j[k] === "string") rec.secrets.add(j[k]);
        issuesTokens = true;
      } catch {
        // not JSON
      }
    }
    rec.responses.push({ path, status: res.status, headers: res.headers, body, issuesTokens });
    return res;
  };
}
