# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Google Tasks MCP Server — an open-source Model Context Protocol server that lets AI assistants manage Google Tasks through natural language. Built with Hono, MCP SDK, and Deno KV. Deployed on Deno Deploy.

## Commands

- **Build**: `npm run build` (runs `tsc`)
- **Dev (watch)**: `npm run dev` (runs `tsc --watch`)
- **Lint**: `deno lint` (configured in `deno.json`, targets `src/`)
- **Run**: `deno task dev` (runs compiled `build/index.js`)
- **Generate encryption secret**: `npm run generate-secret`

No test framework is configured.

## Architecture

### Entry Point & Runtime

`src/index.ts` initializes Deno KV stores (tokens, OAuth sessions, rate limiter), sets OAuth config from env vars, creates the Hono app, and exports `{ fetch: app.fetch }` for Deno Deploy.

### Request Flow

```
Client → Hono HTTP (app.ts) → Security headers middleware → CORS middleware
  ├── OAuth routes (/register, /authorize, /callback, /token) → oauth.ts
  ├── MCP routes (/mcp GET/POST) → Bearer auth middleware → mcp-endpoints.ts
  │     └── Creates McpServer + HonoSSETransport per session
  │           └── Registered tools (tools/*.ts) → google/api.ts → Google Tasks API
  └── Static routes (/, /health, /privacy-policy, /favicon.ico)
```

### Key Modules

- **`src/server/app.ts`** — Hono routes and security middleware. Route-specific CSP headers override the default restrictive CSP (the middleware checks `c.res.headers` before setting defaults).
- **`src/server/mcp-endpoints.ts`** — GET creates SSE stream + MCP session; POST either creates a new session or routes messages to existing ones. Sessions use `TransformStream` for SSE output with 15s heartbeat pings.
- **`src/transport/mcp-transport.ts`** — Custom `HonoSSETransport` implementing MCP's `Transport` interface. `SessionManager` tracks sessions with 30-minute timeout and periodic cleanup.
- **`src/auth/oauth.ts`** — Full OAuth 2.0 with PKCE. Three-legged flow: client registers → redirects to Google → callback exchanges code → returns MCP bearer token (UUID). `OAuthStore` uses Deno KV with TTLs.
- **`src/auth/token-store.ts`** — Encrypts Google tokens (AES-256-GCM) before storing in Deno KV. 30-day TTL.
- **`src/google/api.ts`** — Thin wrapper over Google Tasks REST API. All calls go through `makeGoogleRequest()` which handles auth token refresh automatically (60s expiry threshold). Functions return promises directly (not async).
- **`src/tools/tasklists.ts`** and **`src/tools/tasks.ts`** — 14 MCP tools registered via `server.registerTool()`. Each uses Zod for input schemas and `addReadableTimestamps()` for response processing.
- **`src/utils/logger.ts`** — Logger with automatic redaction of tokens, secrets, user IDs. Set level via `LOG_LEVEL` env var.
- **`src/utils/encryption.ts`** — AES-256-GCM with PBKDF2 key derivation (100k iterations). Requires `ENCRYPTION_SECRET` env var (32+ chars).

### Tool Registration Pattern

Tools are registered in `registerTaskListsTools()` and `registerTasksTools()`, called from `tools/index.ts`. Each tool follows:
```typescript
server.registerTool("tool_name", {
  description: "...",
  inputSchema: { param: z.string().describe("...") },
}, async (args: any) => {
  const result = await apiFunction(mcpAccessToken, ...);
  return { content: [{ type: "text", text: JSON.stringify(addReadableTimestamps(result), null, 2) }] };
});
```

### Environment Variables

Required: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `ENCRYPTION_SECRET`
Optional: `PORT` (default 3000), `LOG_LEVEL` (default info), `ALLOWED_ORIGINS` (comma-separated)

## Conventions

- TypeScript with `.ts` import extensions (compiled to `.js` via `rewriteRelativeImportExtensions`)
- Explicit `import process from "node:process"` and `import { Buffer } from "node:buffer"` (Deno compatibility)
- `nodenext` module resolution
- Deno lint with `no-explicit-any` and `no-console` excluded
- All Google API functions in `api.ts` are non-async (return promises from `makeGoogleRequest`)
- Rate limiting on OAuth endpoints: /register (30/hr), /authorize (60/hr), /token (100/hr)
