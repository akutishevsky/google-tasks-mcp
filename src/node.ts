#!/usr/bin/env node
// Node entrypoint (Cloud Run, containers, local): serves the app on PORT.

import process from "node:process";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { type Config, loadConfig } from "./config.ts";
import { buildDeps } from "./deps.ts";
import { createApp } from "./server/app.ts";
import { createLogger } from "./utils/logger.ts";

const logger = createLogger({ component: "node" });

export async function startNodeServer(config: Config): Promise<{ port: number; close(): Promise<void> }> {
  const deps = await buildDeps(config);
  const app = createApp(deps);
  return await new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: config.port }, (info: AddressInfo) => {
      resolve({
        port: info.port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              deps.store.close().finally(done);
            });
          }),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { port } = await startNodeServer(loadConfig(process.env));
  logger.info("Listening", { port });
}
