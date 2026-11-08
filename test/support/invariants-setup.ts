// vitest setup file: collect log lines per test, then check the invariants for
// every server the test started.
import { afterEach, beforeEach, vi } from "vitest";
import { assertInvariants, logs, takeTracked } from "./invariants.ts";

beforeEach(() => {
  logs.length = 0;
  takeTracked();
  for (const level of ["log", "warn", "error"] as const) {
    const original = console[level].bind(console);
    // Observes console output (not src/); still prints it.
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
      original(...args);
    });
  }
});

afterEach(async () => {
  const recs = takeTracked();
  const lines = logs.splice(0, logs.length);
  vi.restoreAllMocks();
  await assertInvariants(recs, lines);
});
