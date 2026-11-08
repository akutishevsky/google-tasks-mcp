#!/usr/bin/env node
// Deno Deploy entrypoint: exports { fetch }. On Node, run build/node.js instead.

import process from "node:process";
import { loadConfig } from "./config.ts";
import { buildDeps } from "./deps.ts";
import { createApp } from "./server/app.ts";

const deps = await buildDeps(loadConfig(process.env));
const app = createApp(deps);

export default {
  fetch: app.fetch,
};
