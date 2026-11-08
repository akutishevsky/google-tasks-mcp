import { describe, expect, it } from "vitest";
import { pkceS256 } from "../../src/auth/tokens.ts";

describe("PKCE", () => {
  it("rfc7636_vector", () => {
    // RFC 7636 Appendix B (oracle rank 5: published test vector).
    expect(pkceS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
