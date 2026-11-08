// Stateful store access: one suite, run against every Store backend (§11.6).
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Store } from "../../src/store/store.ts";
import { TestClock } from "../support/clock.ts";

export type StoreFactory = (clock: TestClock) => Promise<Store>;

export function runStoreSuite(
  name: string,
  make: StoreFactory,
  opts: { persistent: boolean; reopen: (clock: TestClock) => Promise<Store>; modelRuns?: number },
) {
  describe(`Store: ${name}`, () => {
    it("read_after_write", async () => {
      const s = await make(new TestClock());
      await s.set(["a", "1"], { x: 1, nested: { y: [1, 2] } });
      expect(await s.get(["a", "1"])).toEqual({ x: 1, nested: { y: [1, 2] } });
      await s.close();
    });

    it("delete_then_read", async () => {
      const s = await make(new TestClock());
      await s.set(["a", "1"], "v");
      await s.delete(["a", "1"]);
      expect(await s.get(["a", "1"])).toBeNull();
      await s.close();
    });

    it("expired_entry_invisible", async () => {
      const clock = new TestClock();
      const s = await make(clock);
      await s.set(["e", "1"], "v", { ttlMs: 1000 });
      await s.set(["e", "2"], "w", { ttlMs: 1000 });
      clock.advance(999);
      expect(await s.get(["e", "1"])).toBe("v");
      clock.advance(1);
      expect(await s.get(["e", "1"])).toBeNull();
      expect(await s.take(["e", "2"])).toBeNull();
      expect(await s.list(["e"])).toEqual([]);
      await s.close();
    });

    it("take_has_one_winner", async () => {
      const s = await make(new TestClock());
      await s.set(["t", "k"], "prize");
      const results = await Promise.all(Array.from({ length: 20 }, () => s.take(["t", "k"])));
      expect(results.filter((r) => r !== null)).toEqual(["prize"]);
      expect(await s.get(["t", "k"])).toBeNull();
      await s.close();
    });

    it("list_by_prefix", async () => {
      const s = await make(new TestClock());
      await s.set(["g", "a", "1"], 1);
      await s.set(["g", "a", "2"], 2);
      await s.set(["g", "b", "1"], 3);
      await s.set(["h", "a"], 4);
      const got = (await s.list<number>(["g", "a"])).sort((x, y) => x.value - y.value);
      expect(got).toEqual([
        { key: ["g", "a", "1"], value: 1 },
        { key: ["g", "a", "2"], value: 2 },
      ]);
      await s.close();
    });

    it("survives_reopen", async () => {
      const clock = new TestClock();
      const s = await make(clock);
      await s.set(["p", "1"], "kept");
      await s.close();
      const again = await opts.reopen(clock);
      if (opts.persistent) {
        expect(await again.get(["p", "1"])).toBe("kept");
      } else {
        // Documented trap: @deno/kv on Node without a path is in memory.
        expect(await again.get(["p", "1"])).toBeNull();
      }
      await again.close();
    });

    it("model_based_sequences", async () => {
      const keyArb = fc.tuple(fc.constantFrom("m", "n"), fc.constantFrom("1", "2", "3"));
      const cmdArb = fc.oneof(
        fc.record({ op: fc.constant("set" as const), key: keyArb, value: fc.integer() }),
        fc.record({ op: fc.constant("get" as const), key: keyArb }),
        fc.record({ op: fc.constant("delete" as const), key: keyArb }),
        fc.record({ op: fc.constant("take" as const), key: keyArb }),
        fc.record({ op: fc.constant("list" as const), prefix: fc.constantFrom("m", "n") }),
      );
      await fc.assert(
        fc.asyncProperty(fc.array(cmdArb, { maxLength: 25 }), async (cmds) => {
          const s = await make(new TestClock());
          const model = new Map<string, number>();
          try {
            for (const c of cmds) {
              if (c.op === "set") {
                await s.set(c.key, c.value);
                model.set(c.key.join("/"), c.value);
              } else if (c.op === "get") {
                expect(await s.get(c.key)).toBe(model.get(c.key.join("/")) ?? null);
              } else if (c.op === "delete") {
                await s.delete(c.key);
                model.delete(c.key.join("/"));
              } else if (c.op === "take") {
                expect(await s.take(c.key)).toBe(model.get(c.key.join("/")) ?? null);
                model.delete(c.key.join("/"));
              } else {
                const got = (await s.list<number>([c.prefix])).map((e) => `${e.key.join("/")}=${e.value}`).sort();
                const want = [...model].filter(([k]) => k.startsWith(`${c.prefix}/`)).map(([k, v]) => `${k}=${v}`).sort();
                expect(got).toEqual(want);
              }
            }
          } finally {
            await s.close();
          }
        }),
        { numRuns: opts.modelRuns ?? 100 },
      );
    }, 120_000);
  });
}
