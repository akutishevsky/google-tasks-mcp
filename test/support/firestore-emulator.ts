// Starts the Firestore emulator in Docker for the store suite. When Docker is
// unavailable the tier is reported as NOT RUN (and fails under CI=true), never
// skipped silently (§11.6).
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import process from "node:process";

const IMAGE = "gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators";
export const EMULATOR_PROJECT = "gtasks-mcp-test";

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

export type Emulator = { host: string; reset(): Promise<void>; stop(): void };

export async function startFirestoreEmulator(): Promise<Emulator> {
  const port = await freePort();
  const id = execFileSync(
    "docker",
    ["run", "-d", "--rm", "-p", `127.0.0.1:${port}:8080`, IMAGE, "gcloud", "emulators", "firestore", "start", "--host-port=0.0.0.0:8080"],
    { encoding: "utf-8" },
  ).trim();
  const host = `127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      // Docker's port proxy accepts before the emulator listens; never wait forever.
      const r = await fetch(`http://${host}/`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" });
      throw new Error("Firestore emulator did not start within 90 s");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  process.env.FIRESTORE_EMULATOR_HOST = host;
  return {
    host,
    async reset() {
      await fetch(`http://${host}/emulator/v1/projects/${EMULATOR_PROJECT}/databases/(default)/documents`, {
        method: "DELETE",
        signal: AbortSignal.timeout(10_000),
      });
    },
    stop() {
      execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" });
    },
  };
}
