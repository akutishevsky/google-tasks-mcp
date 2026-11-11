import { afterAll, beforeAll, describe, expect, it } from "vitest";
import process from "node:process";
import { DynamoDbStore } from "../../src/store/dynamodb.ts";
import { runStoreSuite } from "./store.suite.ts";
import { buildDeps } from "../../src/deps.ts";
import { AwsKmsCipher } from "../../src/crypto/awskms.ts";
import { testConfig } from "../support/test-server.ts";
import { dockerAvailable, startDynamoLocal, TEST_TABLE, type DynamoLocal } from "../support/dynamodb-local.ts";

const available = dockerAvailable();

if (!available) {
  const msg = "DynamoDB Local tier NOT RUN: docker unavailable";
  console.warn(msg);
  describe("Store: DynamoDbStore (local)", () => {
    it.runIf(process.env.CI === "true")("local_tier_required_in_ci", () => {
      throw new Error(msg);
    });
    it.skip(msg, () => {});
  });
} else {
  let dynamo: DynamoLocal;
  beforeAll(async () => {
    dynamo = await startDynamoLocal();
  }, 120_000);
  afterAll(() => {
    dynamo?.stop();
  });

  runStoreSuite(
    "DynamoDbStore (local)",
    async (clock) => {
      await dynamo.reset();
      return new DynamoDbStore(dynamo.client(), TEST_TABLE, clock.now);
    },
    { persistent: true, reopen: async (clock) => new DynamoDbStore(dynamo.client(), TEST_TABLE, clock.now), modelRuns: 25 },
  );

  describe("buildDeps (aws option)", () => {
    it("config_aws_builds", async () => {
      await dynamo.reset();
      process.env.AWS_ENDPOINT_URL_DYNAMODB = dynamo.endpoint;
      process.env.AWS_ACCESS_KEY_ID = "fake";
      process.env.AWS_SECRET_ACCESS_KEY = "fake";
      try {
        const deps = await buildDeps(
          testConfig({
            STORAGE: "dynamodb",
            DYNAMODB_TABLE: TEST_TABLE,
            AWS_REGION: "us-east-1",
            CIPHER: "awskms",
            AWS_KMS_KEY_ID: "arn:aws:kms:us-east-1:111122223333:key/abcd",
            ENCRYPTION_SECRET: undefined,
          }),
        );
        try {
          expect(deps.store).toBeInstanceOf(DynamoDbStore);
          expect(deps.cipher).toBeInstanceOf(AwsKmsCipher);
          await deps.store.set(["clients", "c1"], { ok: true });
          expect(await deps.store.get(["clients", "c1"])).toEqual({ ok: true });
        } finally {
          await deps.store.close();
        }
      } finally {
        delete process.env.AWS_ENDPOINT_URL_DYNAMODB;
        delete process.env.AWS_ACCESS_KEY_ID;
        delete process.env.AWS_SECRET_ACCESS_KEY;
      }
    });
  });
}
