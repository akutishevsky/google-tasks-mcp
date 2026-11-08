// Builds the app the characterisation goldens run against.
import type { GoogleFake } from "../support/google-fake.ts";
import { startTestServer } from "../support/test-server.ts";

export async function makeCharacterisationApp(google: GoogleFake) {
  const { app, deps } = await startTestServer({ google });
  return {
    app,
    cleanup: async () => {
      await deps.store.close();
    },
  };
}
