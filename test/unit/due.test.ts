// Pure transforms: due-date normalisation and due-time title suffix.
// Oracle: spec examples + round-trip properties.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { addDueTimeFields, formatDueTime, normalizeDueDate, parseDueTime, withDueTime } from "../../src/utils/due.ts";

const hhmm = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
const qualifier = fc.constantFrom("at" as const, "before" as const, "by" as const);

describe("normalizeDueDate", () => {
  it("date_only_becomes_midnight_utc", () => {
    expect(normalizeDueDate("2026-10-20")).toBe("2026-10-20T00:00:00.000Z");
  });

  it("keeps_date_part_verbatim", () => {
    expect(normalizeDueDate("2025-01-15T22:00:00-08:00")).toBe("2025-01-15T00:00:00.000Z");
    expect(normalizeDueDate("2025-01-15T00:00:00.000Z")).toBe("2025-01-15T00:00:00.000Z");
  });

  it("rejects_impossible_dates", () => {
    for (const bad of ["2025-02-30", "2025-13-01", "tomorrow", "15/01/2025", ""]) {
      expect(() => normalizeDueDate(bad)).toThrow(`Invalid due date "${bad}": expected YYYY-MM-DD`);
    }
  });

  it("idempotent", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date("2000-01-01T00:00:00Z"), max: new Date("2100-01-01T00:00:00Z"), noInvalidDate: true }),
        (d) => {
          const once = normalizeDueDate(d.toISOString().slice(0, 10));
          expect(normalizeDueDate(once)).toBe(once);
          expect(once.slice(0, 10)).toBe(d.toISOString().slice(0, 10));
        },
      ),
    );
  });
});

describe("formatDueTime / parseDueTime", () => {
  it("examples", () => {
    expect(formatDueTime("15:30")).toBe("(at 3:30 PM)");
    expect(formatDueTime("03:30")).toBe("(at 3:30 AM)");
    expect(formatDueTime("16:30", "before")).toBe("(before 4:30 PM)");
    expect(formatDueTime("00:00")).toBe("(at 12:00 AM)");
    expect(formatDueTime("12:00", "by")).toBe("(by 12:00 PM)");
  });

  it("round_trips", () => {
    fc.assert(
      fc.property(hhmm, qualifier, fc.string(), (time, q, title) => {
        expect(parseDueTime(`${title} ${formatDueTime(time, q)}`)).toEqual({ time, qualifier: q });
      }),
    );
  });

  it("parse_is_case_insensitive_and_tolerates_trailing_space", () => {
    expect(parseDueTime("Dentist (AT 3:30 pm) ")).toEqual({ time: "15:30", qualifier: "at" });
  });

  it("parse_returns_undefined_without_suffix", () => {
    expect(parseDueTime("Dentist")).toBeUndefined();
    expect(parseDueTime("(at 3:30 PM) Dentist")).toBeUndefined();
  });
});

describe("withDueTime", () => {
  it("appends_with_one_space", () => {
    expect(withDueTime("Call the dentist", "15:30")).toBe("Call the dentist (at 3:30 PM)");
  });

  it("replaces_existing_suffix", () => {
    expect(withDueTime("Call the dentist (at 3:30 PM)", "16:30", "before")).toBe("Call the dentist (before 4:30 PM)");
  });

  it("empty_time_strips_suffix", () => {
    expect(withDueTime("Call the dentist (at 3:30 PM)", "")).toBe("Call the dentist");
    expect(withDueTime("Call the dentist", "")).toBe("Call the dentist");
  });

  it("never_stacks_suffixes", () => {
    fc.assert(
      fc.property(fc.string(), fc.array(hhmm, { minLength: 1, maxLength: 5 }), (title, times) => {
        const out = times.reduce((t, time) => withDueTime(t, time), title);
        const count = (s: string) => s.match(/\((at|before|by) /g)?.length ?? 0;
        expect(count(out)).toBeLessThanOrEqual(count(title) + 1);
        expect(parseDueTime(out)).toEqual({ time: times.at(-1), qualifier: "at" });
      }),
    );
  });
});

describe("addDueTimeFields", () => {
  it("decorates_tasks_with_suffix_only", () => {
    const input = { items: [{ title: "A (at 3:30 PM)", due: "2026-10-20T00:00:00.000Z" }, { title: "B" }] };
    expect(addDueTimeFields(input)).toEqual({
      items: [
        { title: "A (at 3:30 PM)", due: "2026-10-20T00:00:00.000Z", due_time: "15:30", due_time_qualifier: "at" },
        { title: "B" },
      ],
    });
  });

  it("proto_key_copied_as_data", () => {
    const out = addDueTimeFields(JSON.parse('{"title":"t","__proto__":{"polluted":true}}')) as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(out.polluted).toBeUndefined();
  });
});
