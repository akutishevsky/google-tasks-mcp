// Pure transform: Firestore document-id encoding. Oracle: properties.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decodeDocId, encodeDocId } from "../../src/store/firestore.ts";

const part = fc.string({ unit: "binary", minLength: 1, maxLength: 12 });
const key = fc.array(part, { minLength: 1, maxLength: 4 });

describe("encodeDocId", () => {
  it("roundtrip", () => {
    fc.assert(
      fc.property(key, (k) => {
        expect(decodeDocId(encodeDocId(k))).toEqual(k);
      }),
    );
  });

  it("no_collisions", () => {
    fc.assert(
      fc.property(key, key, (a, b) => {
        fc.pre(JSON.stringify(a) !== JSON.stringify(b));
        expect(encodeDocId(a)).not.toBe(encodeDocId(b));
      }),
    );
  });

  it("valid_firestore_ids", () => {
    fc.assert(
      fc.property(key, (k) => {
        const id = encodeDocId(k);
        expect(id).not.toContain("/");
        expect(id).not.toMatch(/^\.\.?$/);
        expect(id).not.toMatch(/^__.*__$/);
      }),
    );
  });

  it("prefix_order", () => {
    fc.assert(
      fc.property(key, key, (p, other) => {
        const lo = encodeDocId(p) + "~";
        const hi = encodeDocId(p) + "~";
        // Every extension of p falls inside the range.
        const ext = encodeDocId([...p, ...other]);
        expect(ext > lo && ext < hi).toBe(true);
        // A key that does not extend p falls outside it.
        const extendsP = other.length > p.length && p.every((x, i) => x === other[i]);
        if (!extendsP) {
          const id = encodeDocId(other);
          expect(id >= lo && id < hi).toBe(false);
        }
      }),
    );
  });
});
