// Pure transform: DynamoDB sort-key encoding. Oracle: properties.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decodeSortKey, encodeSortKey } from "../../src/store/dynamodb.ts";

const part = fc.string({ unit: "binary", minLength: 1, maxLength: 12 });
const key = fc.array(part, { minLength: 1, maxLength: 4 });

describe("encodeSortKey", () => {
  it("roundtrip", () => {
    fc.assert(
      fc.property(key, (k) => {
        expect(decodeSortKey(encodeSortKey(k))).toEqual(k);
      }),
    );
  });

  it("no_collisions", () => {
    fc.assert(
      fc.property(key, key, (a, b) => {
        fc.pre(JSON.stringify(a) !== JSON.stringify(b));
        expect(encodeSortKey(a)).not.toBe(encodeSortKey(b));
      }),
    );
  });

  it("prefix_order", () => {
    fc.assert(
      fc.property(key, key, (p, other) => {
        const lo = encodeSortKey(p) + "~";
        // begins_with(sk, prefix + "~") selects exactly the extensions of p.
        const ext = encodeSortKey([...p, ...other]);
        expect(ext.startsWith(lo)).toBe(true);
        const extendsP = other.length > p.length && p.every((x, i) => x === other[i]);
        if (!extendsP) {
          expect(encodeSortKey(other).startsWith(lo)).toBe(false);
        }
      }),
    );
  });
});
