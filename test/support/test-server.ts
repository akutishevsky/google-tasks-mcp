// Builds a real app (no src/ mocks) over an in-memory store, a test clock and
// the Google fake. Pass `store` to share state between instances.
import { createApp } from "../../src/server/app.ts";
import type { AppDeps } from "../../src/deps.ts";
import { type Config, loadConfig } from "../../src/config.ts";
import { DenoKvStore } from "../../src/store/denokv.ts";
import { StaticCipher } from "../../src/crypto/static.ts";
import { TestClock } from "./clock.ts";
import { GoogleFake } from "./google-fake.ts";
import { recordingFetch, track, type ServerRecord } from "./invariants.ts";
import {
  PLANTED_GOOGLE_CLIENT_CREDENTIAL,
  PLANTED_GOOGLE_CLIENT_ID,
  PLANTED_KEY_MATERIAL,
  PLANTED_REDIRECT_URI,
} from "./planted.ts";

export type TestServer = {
  app: ReturnType<typeof createApp>;
  deps: AppDeps;
  clock: TestClock;
  google: GoogleFake;
};

/** Config as the server would load it from env; `env` adds or overrides variables. */
export function testConfig(env: Record<string, string | undefined> = {}): Config {
  return loadConfig({
    GOOGLE_CLIENT_ID: PLANTED_GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: PLANTED_GOOGLE_CLIENT_CREDENTIAL,
    GOOGLE_REDIRECT_URI: PLANTED_REDIRECT_URI,
    ENCRYPTION_SECRET: PLANTED_KEY_MATERIAL,
    ...env,
  });
}

export async function startTestServer(
  overrides: Partial<Omit<AppDeps, "clock">> & { clock?: TestClock; google?: GoogleFake; env?: Record<string, string | undefined> } = {},
): Promise<TestServer> {
  const clock = overrides.clock ?? new TestClock();
  const google = overrides.google ?? new GoogleFake();
  const config = overrides.config ?? testConfig(overrides.env);
  const deps: AppDeps = {
    store: overrides.store ?? (await DenoKvStore.open({ clock: clock.now })),
    clock: clock.now,
    config,
    cipher: overrides.cipher ?? new StaticCipher(config.encryptionSecret ?? PLANTED_KEY_MATERIAL),
    fetch: overrides.fetch ?? google.fetch,
  };
  const app = createApp(deps);
  // Every request through this app is recorded for the invariants (§11.8).
  const rec: ServerRecord = { store: deps.store, responses: [], secrets: new Set() };
  track(rec);
  const recorded = recordingFetch((req) => app.fetch(req), rec);
  return { app: { fetch: recorded } as unknown as typeof app, deps, clock, google };
}
