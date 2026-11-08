// Pure transform: addReadableTimestamps. Oracle: properties, TZ=UTC.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import process from "node:process";
import { addReadableTimestamps } from "../../src/utils/timestamp.ts";

const TS_KEYS = ["updated", "completed", "due", "created"] as const;

const isoDate = fc
  .date({ min: new Date("2000-01-01T00:00:00Z"), max: new Date("2100-01-01T00:00:00Z"), noInvalidDate: true })
  .map((d) => d.toISOString());

// Task-like objects: timestamp keys mixed with arbitrary JSON, nested one level.
const taskLike = fc.letrec((tie) => ({
  node: fc.record(
    {
      updated: isoDate,
      completed: isoDate,
      due: isoDate,
      created: isoDate,
      title: fc.string(),
      extra: fc.jsonValue(),
      items: fc.array(tie("leaf"), { maxLength: 3 }),
    },
    { requiredKeys: [] },
  ),
  leaf: fc.record({ due: isoDate, title: fc.string() }, { requiredKeys: [] }),
})).node;

function readableKeys(o: unknown, path = ""): string[] {
  if (Array.isArray(o)) return o.flatMap((x, i) => readableKeys(x, `${path}[${i}]`));
  if (o && typeof o === "object") {
    return Object.entries(o).flatMap(([k, v]) => [
      ...(k.endsWith("_readable") ? [`${path}.${k}`] : []),
      ...readableKeys(v, `${path}.${k}`),
    ]);
  }
  return [];
}

function expectedReadableKeys(o: unknown, path = ""): string[] {
  if (Array.isArray(o)) return o.flatMap((x, i) => expectedReadableKeys(x, `${path}[${i}]`));
  if (o && typeof o === "object") {
    return Object.entries(o).flatMap(([k, v]) => {
      if ((TS_KEYS as readonly string[]).includes(k) && typeof v === "string") return [`${path}.${k}_readable`];
      return expectedReadableKeys(v, `${path}.${k}`);
    });
  }
  return [];
}

function stripReadable(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(stripReadable);
  if (o && typeof o === "object") {
    return Object.fromEntries(
      Object.entries(o).filter(([k]) => !k.endsWith("_readable")).map(([k, v]) => [k, stripReadable(v)]),
    );
  }
  return o;
}

describe("addReadableTimestamps", () => {
  it("original_fields_unchanged", () => {
    fc.assert(
      fc.property(taskLike, (input) => {
        expect(stripReadable(addReadableTimestamps(input))).toEqual(stripReadable(input));
      }),
    );
  });

  it("readable_only_for_timestamp_keys", () => {
    fc.assert(
      fc.property(taskLike, (input) => {
        expect(readableKeys(addReadableTimestamps(input)).sort()).toEqual(
          [...readableKeys(input), ...expectedReadableKeys(input)].filter((v, i, a) => a.indexOf(v) === i).sort(),
        );
      }),
    );
  });

  it("idempotent", () => {
    fc.assert(
      fc.property(taskLike, (input) => {
        const once = addReadableTimestamps(input);
        expect(addReadableTimestamps(once)).toEqual(once);
      }),
    );
  });

  it("due_readable_is_utc_calendar_date_with_weekday", () => {
    expect(addReadableTimestamps({ due: "2026-10-20T00:00:00.000Z" }).due_readable).toBe("Tuesday, October 20, 2026");
  });

  it("due_readable_ignores_server_tz", () => {
    const prev = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(addReadableTimestamps({ due: "2026-10-20T00:00:00.000Z" }).due_readable).toBe("Tuesday, October 20, 2026");
    } finally {
      process.env.TZ = prev;
    }
  });

  it("proto_key_copied_as_data", () => {
    // Found by original_fields_unchanged: JSON.parse yields an own "__proto__"
    // key, which plain assignment would turn into the result's prototype.
    const input = JSON.parse('{"title":"t","__proto__":{"polluted":true}}');
    const out = addReadableTimestamps(input);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(true);
    expect((out as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
