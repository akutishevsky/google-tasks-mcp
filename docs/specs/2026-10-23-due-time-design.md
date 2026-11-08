# Due dates and due times — design

Date: 2026-10-23 (2026.W43)

## Why

A user reported that "time is being stripped out" of tasks created through
this server. Google's Task resource documents this as intended behaviour for
the `due` field: "Only date information is recorded; the time portion of the
timestamp is discarded when setting this field. It isn't possible to read or
write the time that a task is scheduled for using the API."
(<https://developers.google.com/workspace/tasks/reference/rest/v1/tasks>).

Today the tools pass `due` straight through as an RFC 3339 instant. That has
two consequences:

1. Users expect a time and silently lose it.
2. The date can shift. Google keeps the UTC date of whatever instant it
   receives, so `2025-01-15T22:00:00-08:00` is stored as 16 January. On the
   way out, `due_readable` is rendered with the server's timezone, so a
   midnight-UTC date can display as the previous evening on a host west of UTC.

## Intent

Treat `due` as a calendar date, never an instant, at the MCP boundary; record
the wall-clock time the user asked for as text in the title; and tell users
and models plainly that this is a Google API limitation.

The time is text, not an instant, so it needs no timezone: "3:30 PM" means the
user's 3:30 PM. Resolving relative dates ("tomorrow") to a calendar date is
the model's job, since only the client knows the user's local time.

Keeping the time on the server side, as a structured input and a structured
output, means a future Google API that supports times can be adopted by
changing one module without changing the tool contract.

## Goals

- `insert_task`, `update_task` and `patch_task` accept `due` as `YYYY-MM-DD`
  and send Google midnight UTC on that calendar date. A full RFC 3339 value
  is still accepted and its date part is used verbatim, never converted
  through UTC.
- The same three tools accept `dueTime` (24-hour `HH:MM`) and an optional
  `dueTimeQualifier` (`at`, `before`, `by`; default `at`). The server appends
  ` (at 3:30 PM)` to the title, replacing any existing suffix. An empty
  `dueTime` removes the suffix.
- When a title carries that suffix, task responses expose `due_time`
  (`HH:MM`) and `due_time_qualifier` next to `due`, so a model can answer
  "what is due at 3pm" without parsing titles itself.
- `due_readable` is rendered from the UTC calendar date only, with the
  weekday, and never varies with the server's timezone.
- README explains the limitation and the title convention; tool descriptions
  say the same so models stop promising times.

## Non-goals

- Changing `dueMin` and `dueMax` on `list_tasks`. They remain RFC 3339
  filters; the description notes that Google compares them against midnight
  UTC of the due date.
- Rendering `updated` and `completed` differently. They are true instants.
- Any attempt to reach Google's private time field.

## Anti-goals

- A date that lands on the wrong day for any timezone. That would be worse
  than the current behaviour.
- A suffix that drifts in format between writes, so that replacement fails
  and titles accumulate "(at 3:00 PM) (at 4:00 PM)".

## Decisions (the author's calls, open to override)

- Suffix format: `(at 3:30 PM)`, 12-hour clock, no leading zero on the hour,
  two-digit minutes, a space before the meridiem, upper-case `AM`/`PM`.
  Midnight is `12:00 AM`, noon is `12:00 PM`.
- Suffix position: end of the title, one space before the opening bracket.
- Recognised suffix on read and replace: `\s*\((at|before|by)
  \d{1,2}:\d{2} (AM|PM)\)\s*$`, case-insensitive.
- `dueTimeQualifier` without `dueTime` is ignored.
- `update_task` and `patch_task` with `dueTime` but no `title` fetch the task
  first to obtain the current title. One extra GET, only on that path.
- Invalid `due` (not a real calendar date) is rejected by the tool before any
  Google call, with the message
  `Invalid due date "<value>": expected YYYY-MM-DD`.
- `due_readable` example: `Monday, October 20, 2026` for
  `2026-10-20T00:00:00.000Z`.
- New logic lives in `src/utils/due.ts`; tools call it. No new dependencies.
