// KmsCipher against a faithful KMS fake. Oracle: properties.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Buffer } from "node:buffer";
import { KmsCipher } from "../../src/crypto/kms.ts";
import { BackendUnavailableError } from "../../src/store/store.ts";
import { KmsFake } from "../support/kms-fake.ts";
import { startTestServer } from "../support/test-server.ts";
import { login } from "../support/oauth-driver.ts";
import { callTool } from "../support/mcp-client.ts";

const KEY = "projects/p/locations/l/keyRings/r/cryptoKeys/k";

describe("KmsCipher", () => {
  it("roundtrip", async () => {
    const c = new KmsCipher(new KmsFake(), KEY);
    await fc.assert(
      fc.asyncProperty(fc.string({ unit: "binary" }), async (s) => {
        expect(await c.decrypt(await c.encrypt(s))).toBe(s);
      }),
      { numRuns: 100 },
    );
  });

  it("ciphertext_hides_plaintext", async () => {
    const c = new KmsCipher(new KmsFake(), KEY);
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 8 }), async (s) => {
        const ct = await c.encrypt(s);
        expect(ct).not.toContain(s);
        expect(Buffer.from(ct, "base64").toString("utf-8")).not.toContain(s);
      }),
      { numRuns: 50 },
    );
  });

  it("tamper_throws", async () => {
    const c = new KmsCipher(new KmsFake(), KEY);
    const raw = Buffer.from(await c.encrypt("PLANTED_GOOGLE_REFRESH_A"), "base64");
    raw[raw.length - 1] ^= 1;
    await expect(c.decrypt(raw.toString("base64"))).rejects.toThrow();
  });

  it("wrong_key_name_throws", async () => {
    const kms = new KmsFake();
    const ct = await new KmsCipher(kms, KEY).encrypt("PLANTED_GOOGLE_REFRESH_A");
    await expect(new KmsCipher(kms, `${KEY}-other`).decrypt(ct)).rejects.toThrow();
  });

  it("unavailable_maps_to_backend_error", async () => {
    const kms = new KmsFake();
    const c = new KmsCipher(kms, KEY);
    kms.failNext(14);
    await expect(c.encrypt("x")).rejects.toBeInstanceOf(BackendUnavailableError);
    kms.failNext(3); // INVALID_ARGUMENT is not an outage
    await expect(c.encrypt("x")).rejects.not.toBeInstanceOf(BackendUnavailableError);
  });

  it("kms_unavailable_503", async () => {
    const kms = new KmsFake();
    const s = await startTestServer({ cipher: new KmsCipher(kms, KEY) });
    const { tokens } = await login(s.app, s.google);
    kms.failNext(14);
    const r = await callTool(s.app, tokens.access_token, "list_task_lists", {});
    expect(r.status).toBe(503);
    expect(r.text).not.toContain("fake KMS failure");
    expect(JSON.parse(r.text).error).toBe("temporarily_unavailable");
  });
});
