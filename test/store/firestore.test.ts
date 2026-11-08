import { afterAll, beforeAll, describe, it } from "vitest";
import process from "node:process";
import { Firestore } from "@google-cloud/firestore";
import { FirestoreStore } from "../../src/store/firestore.ts";
import { runStoreSuite } from "./store.suite.ts";
import { buildDeps } from "../../src/deps.ts";
import { KmsCipher } from "../../src/crypto/kms.ts";
import { testConfig } from "../support/test-server.ts";
import { expect } from "vitest";
import { dockerAvailable, EMULATOR_PROJECT, startFirestoreEmulator, type Emulator } from "../support/firestore-emulator.ts";

const available = dockerAvailable();

if (!available) {
  const msg = "Firestore emulator tier NOT RUN: docker unavailable";
  console.warn(msg);
  describe("Store: FirestoreStore (emulator)", () => {
    it.runIf(process.env.CI === "true")("emulator_tier_required_in_ci", () => {
      throw new Error(msg);
    });
    it.skip(msg, () => {});
  });
} else {
  let emulator: Emulator;
  beforeAll(async () => {
    emulator = await startFirestoreEmulator();
  }, 120_000);
  afterAll(() => {
    emulator?.stop();
  });

  const client = () => new Firestore({ projectId: EMULATOR_PROJECT });
  runStoreSuite(
    "FirestoreStore (emulator)",
    async (clock) => {
      await emulator.reset();
      return new FirestoreStore(client(), clock.now);
    },
    { persistent: true, reopen: async (clock) => new FirestoreStore(client(), clock.now), modelRuns: 25 },
  );

  describe("buildDeps (gcloud option)", () => {
    it("config_gcloud_builds", async () => {
      process.env.GOOGLE_CLOUD_PROJECT = EMULATOR_PROJECT;
      const deps = await buildDeps(
        testConfig({
          STORAGE: "firestore",
          FIRESTORE_DATABASE: "(default)",
          CIPHER: "gcpkms",
          KMS_KEY_NAME: "projects/p/locations/l/keyRings/r/cryptoKeys/k",
          ENCRYPTION_SECRET: undefined,
        }),
      );
      try {
        expect(deps.store).toBeInstanceOf(FirestoreStore);
        expect(deps.cipher).toBeInstanceOf(KmsCipher);
        await deps.store.set(["clients", "c1"], { ok: true });
        expect(await deps.store.get(["clients", "c1"])).toEqual({ ok: true });
      } finally {
        await deps.store.close();
      }
    });
  });
}
