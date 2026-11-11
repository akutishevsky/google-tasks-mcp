// Starts amazon/dynamodb-local in Docker for the store suite. When Docker is
// unavailable the tier is reported as NOT RUN (and fails under CI=true), never
// skipped silently (§11.6).
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
  waitUntilTableNotExists,
} from "@aws-sdk/client-dynamodb";

const IMAGE = "amazon/dynamodb-local:latest";
export const TEST_TABLE = "gtasks-mcp-test";

export function dockerAvailable(): boolean {
  return spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { stdio: "ignore" }).status === 0;
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === "object" && addr ? resolve(addr.port) : reject(new Error("no port"))));
    });
  });
}

export type DynamoLocal = { endpoint: string; client(): DynamoDBClient; reset(): Promise<void>; stop(): void };

function makeClient(endpoint: string): DynamoDBClient {
  return new DynamoDBClient({
    endpoint,
    region: "us-east-1",
    credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
  });
}

async function createTable(client: DynamoDBClient): Promise<void> {
  await client.send(
    new CreateTableCommand({
      TableName: TEST_TABLE,
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: TEST_TABLE });
  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: TEST_TABLE,
      TimeToLiveSpecification: { Enabled: true, AttributeName: "ttl" },
    }),
  );
}

export async function startDynamoLocal(): Promise<DynamoLocal> {
  const port = await freePort();
  const id = execFileSync(
    "docker",
    ["run", "-d", "--rm", "-p", `127.0.0.1:${port}:8000`, IMAGE, "-jar", "DynamoDBLocal.jar", "-inMemory"],
    { encoding: "utf-8" },
  ).trim();
  const endpoint = `http://127.0.0.1:${port}`;
  const admin = makeClient(endpoint);
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      await createTable(admin);
      break;
    } catch (error) {
      if ((error as { name?: string }).name === "ResourceInUseException") break; // already created
      if (Date.now() > deadline) {
        execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" });
        throw new Error(`DynamoDB Local did not start within 90 s: ${(error as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return {
    endpoint,
    client: () => makeClient(endpoint),
    async reset() {
      try {
        await admin.send(new DeleteTableCommand({ TableName: TEST_TABLE }));
        await waitUntilTableNotExists({ client: admin, maxWaitTime: 30 }, { TableName: TEST_TABLE });
      } catch (error) {
        if ((error as { name?: string }).name !== "ResourceNotFoundException") throw error;
      }
      await createTable(admin);
    },
    stop() {
      admin.destroy();
      execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" });
    },
  };
}
