# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Google Tasks MCP Server — an open-source Model Context Protocol server that lets AI assistants manage Google Tasks through natural language. Built with Hono, MCP SDK, and Deno KV. Runs on Deno Deploy, Node, or Cloud Run (Firestore + KMS; see `DEPLOY.md`).

## Commands

- **Build**: `npm run build` (runs `tsc`)
- **Dev (watch)**: `npm run dev` (runs `tsc --watch`)
- **Lint**: `deno lint` (configured in `deno.json`, targets `src/`)
- **Run**: `deno task dev` (`deno serve` on :3000, `build/index.js`; `@deno/kv` needs `--allow-ffi`/`--allow-sys`) or `npm start` (Node, `build/node.js`; set `KV_PATH`)
- **Revoke access**: `npm run revoke -- --email <addr> | --all [--dry-run]`
- **Generate encryption secret**: `npm run generate-secret`

- **Test**: `npm test` (vitest + fast-check; see `docs/specs/2026-10-17-gcp-deployment-design.md` §11)
- **Typecheck (incl. tests)**: `npm run typecheck`

## Architecture

### Entry Points & Runtime

- `src/config.ts` — `loadConfig(env)`: the only place env vars are interpreted (the logger's `LOG_LEVEL` aside). Fails fast on invalid combinations.
- `src/deps.ts` — `buildDeps(config)`: builds the injected `AppDeps` (`store`, `cipher`, `clock`, `config`, `fetch`). Firestore/KMS SDKs are optional and imported lazily.
- `src/index.ts` — Deno Deploy: exports `{ fetch: app.fetch }`.
- `src/node.ts` — Node/containers/Cloud Run: serves the app with `@hono/node-server` on `PORT`.
- `src/cli/revoke.ts` — `npm run revoke` kill switch.

### Request Flow

```
Client → Hono HTTP (app.ts) → Security headers middleware → CORS middleware
  ├── OAuth routes (/register, /authorize, /callback, /token) → auth/oauth.ts
  ├── /.well-known/oauth-authorization-server, /.well-known/oauth-protected-resource[/mcp]
  ├── POST /mcp → Bearer middleware (resolve hashed access token → grant) → mcp-endpoints.ts
  │     └── per request: McpServer + stateless WebStandardStreamableHTTPServerTransport (JSON)
  │           └── tools/*.ts → google/api.ts (GoogleClient) → Google Tasks API
  └── Static routes (/, /health, /privacy-policy, /favicon.ico); PUBLIC_PAGES=false → JSON
```

### Key Modules

- **`src/store/`** — `Store` interface (`get/set ttl/delete/take/list`), values wrapped `{ v, expiresAt }` and checked against the injected clock. `DenoKvStore` (default; **in memory on Node unless `KV_PATH`**) and `FirestoreStore`.
- **`src/crypto/`** — `TokenCipher`: `StaticCipher` (upstream AES-256-GCM format, key derived once) and `KmsCipher` (Cloud KMS per token).
- **`src/auth/token-store.ts`** — Grants (encrypted Google tokens, email) plus 1 h access / 30 d rotating refresh tokens, keyed by SHA-256 hash; reuse after a 60 s grace revokes the grant.
- **`src/auth/oauth.ts`** — OAuth 2.1 + PKCE. `/authorize` validates client and redirect (400, never redirects). Google code is exchanged at `/callback` (id_token → email; `ALLOWED_DOMAIN` check). `/token` handles `authorization_code` and `refresh_token`.
- **`src/google/client.ts`** — `GoogleClient` seam and the per-app token provider (Google refresh 60 s early, 5-minute decrypted-token cache; Google `invalid_grant` revokes the grant → 401).
- **`src/google/api.ts`** — Thin wrapper over the Tasks REST API; functions take a `GoogleClient`, are non-async, and treat 204 as success.
- **`src/tools/tasklists.ts`** and **`src/tools/tasks.ts`** — 14 MCP tools registered via `server.registerTool()`. Zod input schemas, `addReadableTimestamps()` on responses.
- **`src/server/rate-limiter.ts`** — Store-backed limits; `TRUST_PROXY_HOPS` picks the client IP from the right of `X-Forwarded-For`.
- **`src/utils/logger.ts`** — Logger with redaction of tokens, secrets, user IDs.

### Tests

`npm test` (vitest + fast-check), organised by the design spec §11: tool and OAuth scenarios through `app.fetch`, a store suite run against every backend (Firestore via its emulator in Docker), pure-transform properties, and security invariants checked after every HTTP test (`test/support/invariants.ts`). Google is replayed from `test/fixtures/google/` through the `fetch` seam; nothing under `src/` is mocked.

### Tool Registration Pattern

Tools are registered in `registerTaskListsTools()` and `registerTasksTools()`, called from `tools/index.ts`. Each tool follows:
```typescript
server.registerTool("tool_name", {
  description: "...",
  inputSchema: { param: z.string().describe("...") },
}, async (args: any) => {
  const result = await apiFunction(client, ...);
  return { content: [{ type: "text", text: JSON.stringify(addReadableTimestamps(result), null, 2) }] };
});
```

### Environment Variables

Required: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ENCRYPTION_SECRET` (with the default `CIPHER=static`). Full table in `MAINTAIN.md`.

## Conventions

- TypeScript with `.ts` import extensions (compiled to `.js` via `rewriteRelativeImportExtensions`)
- Explicit `import process from "node:process"` and `import { Buffer } from "node:buffer"` (Deno compatibility)
- `nodenext` module resolution
- Deno lint with `no-explicit-any` and `no-console` excluded
- All Google API functions in `api.ts` are non-async (return promises from `makeGoogleRequest`)
- Rate limiting on OAuth endpoints: /register (30/hr), /authorize (60/hr), /token (100/hr)
