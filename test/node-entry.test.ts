import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { startNodeServer } from "../src/node.ts";
import { PLANTED_GOOGLE_CLIENT_CREDENTIAL, PLANTED_GOOGLE_CLIENT_ID, PLANTED_KEY_MATERIAL } from "./support/planted.ts";

describe("Node entrypoint", () => {
  it("node_entry_serves_health", async () => {
    const config = loadConfig({
      GOOGLE_CLIENT_ID: PLANTED_GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: PLANTED_GOOGLE_CLIENT_CREDENTIAL,
      ENCRYPTION_SECRET: PLANTED_KEY_MATERIAL,
    });
    const server = await startNodeServer({ ...config, port: 0 });
    try {
      expect(server.port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(res.status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
