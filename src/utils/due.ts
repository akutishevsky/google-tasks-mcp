// Due dates and due times at the MCP boundary.
//
// Google's Tasks API keeps only the calendar date of `due` and discards the
// time ("It isn't possible to read or write the time that a task is scheduled
// for using the API"). So:
//   - `due` is treated as a calendar date, never an instant, and is sent to
//     Google as midnight UTC on that date (no conversion that could move the
//     day);
//   - the wall-clock time the user asked for is recorded as text at the end
//     of the title, e.g. "Call the dentist (at 3:30 PM)", and read back from
//     there.
// See docs/specs/2026-10-23-due-time-design.md.

export type DueTimeQualifier = "at" | "before" | "by";

export const DUE_TIME_QUALIFIERS: readonly DueTimeQualifier[] = ["at", "before", "by"];

/** 24-hour wall-clock time, `HH:MM`. */
export const DUE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;
const SUFFIX = /\s*\((at|before|by) (\d{1,2}):(\d{2}) (AM|PM)\)\s*$/i;

/**
 * `YYYY-MM-DD` or an RFC 3339 timestamp in; `YYYY-MM-DDT00:00:00.000Z` out.
 * The date part is used verbatim, so a local-time timestamp keeps its local
 * calendar date instead of the UTC one.
 */
export function normalizeDueDate(input: string): string {
  const m = DATE_PREFIX.exec(input);
  if (m) {
    const [, y, mo, d] = m.map(Number) as [unknown, number, number, number];
    const t = Date.UTC(y, mo - 1, d);
    const real = new Date(t);
    if (real.getUTCFullYear() === y && real.getUTCMonth() === mo - 1 && real.getUTCDate() === d) {
      return `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`;
    }
  }
  throw new Error(`Invalid due date "${input}": expected YYYY-MM-DD`);
}

/** `"15:30"` → `"(at 3:30 PM)"`. */
export function formatDueTime(time: string, qualifier: DueTimeQualifier = "at"): string {
  const [h, m] = time.split(":").map(Number);
  const meridiem = h < 12 ? "AM" : "PM";
  return `(${qualifier} ${h % 12 || 12}:${String(m).padStart(2, "0")} ${meridiem})`;
}

/** Inverse of `formatDueTime` applied to a title's trailing suffix. */
export function parseDueTime(title: string): { time: string; qualifier: DueTimeQualifier } | undefined {
  const m = SUFFIX.exec(title);
  if (!m) return undefined;
  const qualifier = m[1].toLowerCase() as DueTimeQualifier;
  const h12 = Number(m[2]);
  const h = (h12 % 12) + (m[4].toUpperCase() === "PM" ? 12 : 0);
  return { time: `${String(h).padStart(2, "0")}:${m[3]}`, qualifier };
}

/** Strips any existing suffix, then appends the new one unless `time` is empty. */
export function withDueTime(title: string, time: string, qualifier: DueTimeQualifier = "at"): string {
  const base = title.replace(SUFFIX, "");
  return time === "" ? base : `${base} ${formatDueTime(time, qualifier)}`;
}

// Own data properties even for keys like "__proto__" (see timestamp.ts).
function put(target: any, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Adds `due_time` and `due_time_qualifier` next to any `title` that carries a suffix. */
export function addDueTimeFields(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(addDueTimeFields);
  if (data && typeof data === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(data)) {
      put(result, key, value && typeof value === "object" ? addDueTimeFields(value) : value);
    }
    const parsed = typeof result.title === "string" ? parseDueTime(result.title) : undefined;
    if (parsed) {
      put(result, "due_time", parsed.time);
      put(result, "due_time_qualifier", parsed.qualifier);
    }
    return result;
  }
  return data;
}
