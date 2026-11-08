import { describe, expect, it } from "vitest";
import { startTestServer } from "../support/test-server.ts";
import { req } from "../support/oauth-driver.ts";

const registerFrom = (xff: string) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Forwarded-For": xff },
  body: JSON.stringify({ redirect_uris: ["http://localhost:9999/callback"] }),
});

describe("rate limit", () => {
  it("register_rate_limit", async () => {
    // Planted truth: one client (203.0.113.7) spoofing the leftmost XFF value.
    const s = await startTestServer({ env: { TRUST_PROXY_HOPS: "1" } });
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      statuses.push((await req(s.app, "/register", registerFrom(`10.0.0.${i}, 203.0.113.7`))).status);
    }
    expect(statuses.slice(0, 30).every((st) => st === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    // A different real client is not affected.
    expect((await req(s.app, "/register", registerFrom("10.0.0.1, 198.51.100.9"))).status).toBe(200);
  });
});
