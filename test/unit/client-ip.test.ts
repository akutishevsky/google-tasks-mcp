// Pure transform: client IP from X-Forwarded-For. Oracle: examples.
import { describe, expect, it } from "vitest";
import { clientIp } from "../../src/server/rate-limiter.ts";

const h = (xff?: string, realIp?: string) => {
  const headers = new Headers();
  if (xff !== undefined) headers.set("x-forwarded-for", xff);
  if (realIp !== undefined) headers.set("x-real-ip", realIp);
  return headers;
};

describe("clientIp", () => {
  it("hops_unset_keeps_upstream_behaviour", () => {
    expect(clientIp(h("1.1.1.1, 2.2.2.2"))).toBe("1.1.1.1, 2.2.2.2");
    expect(clientIp(h(undefined, "3.3.3.3"))).toBe("3.3.3.3");
    expect(clientIp(h())).toBe("unknown");
  });

  it("hops_from_the_right", () => {
    expect(clientIp(h("spoofed, 9.9.9.9", undefined), 1)).toBe("9.9.9.9");
    expect(clientIp(h("spoofed, 8.8.8.8, 10.0.0.1"), 2)).toBe("8.8.8.8");
    expect(clientIp(h(" 7.7.7.7 "), 1)).toBe("7.7.7.7");
  });

  it("short_header_falls_back_to_leftmost", () => {
    expect(clientIp(h("6.6.6.6"), 3)).toBe("6.6.6.6");
  });

  it("hops_without_header", () => {
    expect(clientIp(h(undefined, "5.5.5.5"), 1)).toBe("5.5.5.5");
    expect(clientIp(h(), 1)).toBe("unknown");
  });
});
