// Pure transform: StaticCipher. Oracles: properties, and legacy parity (rank 3)
// against upstream's encryption.ts kept verbatim in test/legacy_ref/.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import process from "node:process";
import { Buffer } from "node:buffer";
import { StaticCipher } from "../../src/crypto/static.ts";
import * as legacy from "../legacy_ref/encryption.ts";
import { PLANTED_KEY_MATERIAL } from "../support/planted.ts";

const OTHER_KEY_MATERIAL = "1".repeat(64);

describe("StaticCipher", () => {
  const cipher = new StaticCipher(PLANTED_KEY_MATERIAL);

  it("roundtrip", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ unit: "binary" }), async (s) => {
        expect(await cipher.decrypt(await cipher.encrypt(s))).toBe(s);
      }),
      { numRuns: 200 },
    );
  });

  it("tamper_throws", async () => {
    const ct = await cipher.encrypt("PLANTED_GOOGLE_REFRESH_A");
    const raw = Buffer.from(ct, "base64");
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 64, max: raw.length - 1 }), fc.integer({ min: 1, max: 255 }), async (i, x) => {
        const t = Buffer.from(raw);
        t[i] ^= x;
        await expect(cipher.decrypt(t.toString("base64"))).rejects.toThrow();
      }),
      { numRuns: 50 },
    );
  });

  it("wrong_key_throws", async () => {
    const ct = await cipher.encrypt("PLANTED_GOOGLE_REFRESH_A");
    await expect(new StaticCipher(OTHER_KEY_MATERIAL).decrypt(ct)).rejects.toThrow();
  });

  it("rejects_short_secret", () => {
    expect(() => new StaticCipher("short")).toThrow(/32/);
  });

  it("legacy_ciphertext_decrypts", async () => {
    process.env.ENCRYPTION_SECRET = PLANTED_KEY_MATERIAL;
    await fc.assert(
      fc.asyncProperty(fc.string(), async (s) => {
        expect(await cipher.decrypt(legacy.encrypt(s))).toBe(s);
      }),
      { numRuns: 50 },
    );
  });

  it("new_ciphertext_legacy_decrypts", async () => {
    process.env.ENCRYPTION_SECRET = PLANTED_KEY_MATERIAL;
    await fc.assert(
      fc.asyncProperty(fc.string(), async (s) => {
        expect(legacy.decrypt(await cipher.encrypt(s))).toBe(s);
      }),
      { numRuns: 50 },
    );
  });
});
