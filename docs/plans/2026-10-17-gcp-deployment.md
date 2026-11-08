# GCP deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make google-tasks-mcp run as a persistent, multi-user, domain-restricted server on Cloud Run, while every new behaviour stays opt-in and upstream defaults are unchanged.

**Architecture:** The module-level singletons (KV handles, OAuth config) become dependencies injected into `createApp(deps)`. A `Store` interface replaces direct `@deno/kv` use, and a `TokenCipher` replaces `utils/encryption.ts`. The hand-written SSE transport gives way to the SDK's stateless Streamable HTTP transport. OAuth gains client/redirect validation, protected-resource metadata, rotating refresh tokens and an optional Workspace domain check. The "gcloud option" (`FirestoreStore` + `KmsCipher`) and `infra/` Terraform arrive last.

**Tech Stack:** Node 22, TypeScript 5 (`nodenext`), Hono 4.12, `@hono/node-server` 1.19, `@modelcontextprotocol/sdk` ≥ 1.27.1, `@deno/kv`, zod 3; vitest + fast-check; `@google-cloud/firestore`, `@google-cloud/kms`; Terraform (google provider); Docker for the Firestore emulator.

**Spec:** `docs/specs/2026-10-17-gcp-deployment-design.md`. Section numbers (§) below refer to it.

**Week:** 2026.W42 (written 2026-10-17).

## Global Constraints

- Every change is additive. With none of the new env vars set, behaviour matches upstream (AC7). Defaults: `STORAGE=denokv`, `CIPHER=static`, `PUBLIC_PAGES=true`; `ALLOWED_DOMAIN`, `ISSUER_URL`, `KV_PATH`, `TRUST_PROXY_HOPS` unset.
- Env var names, verbatim: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `ISSUER_URL`, `STORAGE`, `KV_PATH`, `FIRESTORE_DATABASE`, `CIPHER`, `ENCRYPTION_SECRET`, `KMS_KEY_NAME`, `ALLOWED_DOMAIN`, `TRUST_PROXY_HOPS`, `PUBLIC_PAGES`, `PORT`, `LOG_LEVEL`, `ALLOWED_ORIGINS`.
- Only `src/config.ts` reads `process.env`. The one exception is `src/utils/logger.ts` (`LOG_LEVEL` at module load), left alone to keep the upstream diff small.
- Repo conventions: `.ts` relative imports, explicit `node:` imports (`import process from "node:process"`, `import { Buffer } from "node:buffer"`), API functions in `google/api.ts` stay non-async.
- Lifetimes and limits: our access token `expires_in: 3600`; refresh token 30 d, rotated on each use; reuse grace 60 s; Google refresh when `googleExpiresAt − 60 s` has passed; decrypted-token cache `min(5 min, googleExpiresAt − 60 s)`; OAuth sessions and auth codes 10 min; rate limits `/register` 30/h, `/authorize` 60/h, `/token` 100/h.
- Google scope string: `openid email https://www.googleapis.com/auth/tasks`, with `access_type=offline` and `prompt=consent`.
- Testing rules (§11): nothing under `src/` is mocked. Google and KMS are third-party edges: Google is replayed from fixtures through the `fetch` seam, KMS uses a faithful fake client. Time is injected through a clock. Every test file names its scenarios as the spec's tables do.
- Public repo: no organisation-specific values (project ids, domains, hostnames, bucket names) in any committed file. Use placeholders `<project>`, `<region>`, `<domain>`, `<host>`, and `example.com` in tests.
- Each task ends with `npm test` and `npm run typecheck` green, then one commit. Commit messages end with the session's attribution lines.

## Review Focus

1. **Consumer account with `ALLOWED_DOMAIN` set.** An `id_token` with no `hd` claim (gmail.com) must get 403 and nothing stored. Covered by `id_token_without_hd` in Task 11.
2. **Cold start in the middle of a login.** `/authorize` handled by one instance and `/callback` + `/token` by another must succeed, because all state is in the Store. Covered by `login_across_instances` in Task 9.
3. **Unicode and very long task titles.** A 2,000-character title with emoji and CJK must reach Google byte-exact and come back unchanged. Covered by `unicode_long_title_roundtrip` in Task 8.
4. **Two refreshes of one grant at the same instant**, e.g. two tabs. Exactly one gets a new pair, the other gets `invalid_grant`, and the grant survives. Covered by `refresh_concurrent` in Task 10.
5. **Paging past 100 tasks.** `pageToken` must be passed through to Google and `nextPageToken` returned unchanged. Covered by `list_tasks_paged` in Task 8.

## Upstream PR mapping

The commits are ordered so that each upstream PR (§10) can be cut from `upstream/main` by cherry-picking whole tasks. This differs from the spec's PR order: `Store` (PR 5 in §10) moves first, because dependency injection needs it, and every PR carries its own tests on top of the harness PR.

| Upstream PR | Tasks |
|-------------|-------|
| Harness (offered) | 1, 2, 3 |
| Store + `KV_PATH` | 4 |
| Node entrypoint + config | 5 |
| Stateless Streamable HTTP | 6 |
| TokenCipher | 7 |
| Google client seam | 8 |
| Authorize validation + PRM | 9 |
| Token model + refresh grant | 10 |
| Domain, proxy hops, public pages | 11 |
| Revoke command | 12 |
| gcloud option (offered) | 13 |
| Fork only | 14, 15 |

## File structure

```
src/
  config.ts                 loadConfig(env) → Config (replaces the setOAuthConfig singleton)
  deps.ts                   AppDeps type + buildDeps(config) (wires Store, TokenCipher, clock, fetch)
  index.ts                  Deno Deploy entry (export default { fetch }), via buildDeps
  node.ts                   Node entry: @hono/node-server on PORT
  store/store.ts            Store interface, Clock type, wrap/unwrap helpers
  store/denokv.ts           DenoKvStore
  store/firestore.ts        FirestoreStore + encodeDocId/decodeDocId
  crypto/cipher.ts          TokenCipher interface
  crypto/static.ts          StaticCipher (upstream format)
  crypto/kms.ts             KmsCipher
  auth/oauth.ts             OAuth router (createOAuthRouter(deps))
  auth/oauth-store.ts       sessions, auth codes, clients over Store
  auth/token-store.ts       grants / access / refresh / grants_by_email over Store
  auth/id-token.ts          parseIdToken(jwt) → claims (no signature check, §5.4)
  auth/tokens.ts            randomToken(), hashToken()
  server/app.ts             createApp(deps)
  server/middleware.ts      authenticateBearer(deps)
  server/mcp-endpoints.ts   stateless transport handler
  server/rate-limiter.ts    rateLimit(deps, cfg), clientIp(xff, hops)
  google/api.ts             14 functions taking GoogleClient
  google/client.ts          GoogleClient type + createGoogleTokenProvider(deps)
  google/oauth.ts           exchangeCode, refreshGoogleToken, revokeGoogleToken
  tools/*.ts                take GoogleClient instead of mcpAccessToken
  cli/revoke.ts             npm run revoke
  transport/                deleted in Task 6
  utils/encryption.ts       deleted in Task 7
scripts/record-fixtures.ts  one-off recorder (tsx)
test/
  support/                  clock, google fake, test server + OAuth driver, invariants, MCP client
  fixtures/google/*.json    recorded Google responses
  characterisation/         phase-0 goldens (temporary)
  legacy_ref/encryption.ts  verbatim copy of upstream src/utils/encryption.ts
  unit/  store/  oauth/  tools/  cli/
infra/                      Terraform (Task 15)
Dockerfile, .dockerignore, DEPLOY.md, MAINTAIN.md, docs/adr/adr-001-…
```

---

### Task 1: Test harness and the first pure-transform suite

**Files:**
- Modify: `package.json` (devDeps `vitest`, `fast-check`, `tsx`; scripts `test`, `test:watch`, `typecheck`)
- Create: `vitest.config.ts`, `tsconfig.test.json`, `test/support/clock.ts`, `test/support/google-fake.ts`, `test/unit/timestamp.test.ts`
- Modify: `CLAUDE.md` (replace "No test framework is configured." with the test commands)

**Interfaces:**
- Produces:
  - `class TestClock { now(): number; advance(ms: number): void; set(ms: number): void }`, starting at `Date.UTC(2026, 9, 17)`.
  - `type Fixture = { _provenance: "recorded" | "docs"; request: { method: string; path: string; query?: Record<string,string>; bodyContains?: string }; response: { status: number; headers?: Record<string,string>; body: unknown } }`.
  - `class GoogleFake { fetch: typeof fetch; queue(name: string, overrides?: Partial<Fixture["response"]>): void; calls: Array<{ url: URL; method: string; headers: Headers; body: string }> }`. `queue` loads `test/fixtures/google/<name>.json`. `fetch` serves queued responses in order and throws `Unexpected Google call: <METHOD> <path>` when the next queued request doesn't match on method and path, or when nothing is queued.

- [ ] **Step 1: Add deps and config.** `vitest.config.ts`: `test.include = ["test/**/*.test.ts"]`, `env: { TZ: "UTC" }`, `testTimeout: 15000`. `tsconfig.test.json` extends `tsconfig.json` with `rootDir: "."`, `noEmit: true`, `include: ["src", "test", "scripts"]`. Scripts: `"test": "vitest run"`, `"typecheck": "tsc -p tsconfig.test.json"`.
- [ ] **Step 2: Write `test/unit/timestamp.test.ts`** (oracle: properties, `TZ=UTC`), using fast-check over `fc.jsonValue()` mixed with objects carrying ISO strings under `updated|completed|due|created`:
  - `original_fields_unchanged`: for every key in the input, `out[key]` deep-equals `input[key]` when it isn't an object, and recursively when it is.
  - `readable_only_for_timestamp_keys`: the set of keys ending in `_readable` equals `{k + "_readable"}` for string-valued timestamp keys only.
  - `idempotent`: `f(f(x))` deep-equals `f(x)`.
- [ ] **Step 3: Run** `npm test`. Expected: 3 pass. (This certifies existing behaviour. If `idempotent` fails because `*_readable` keys get re-derived, record that as a finding and pin the actual behaviour with a comment rather than changing `src/`.)
- [ ] **Step 4: Write `test/support/google-fake.test.ts`**: `unexpected_call_throws`, `serves_in_order`, `records_calls`. Run, then implement `clock.ts` and `google-fake.ts`, and run again. Expected: pass.
- [ ] **Step 5: Commit** `test: add vitest harness, Google fake and timestamp properties`.

### Task 2: Google fixtures

**Files:**
- Create: `scripts/record-fixtures.ts`, `test/fixtures/google/*.json`, `test/fixtures/README.md`

**Interfaces:**
- Consumes: `Fixture` (Task 1).
- Produces these fixture names, used by later tasks: `token.exchange.ok`, `token.exchange.err`, `token.refresh.ok`, `token.refresh.invalid_grant`, `token.revoke.ok`, and `<endpoint>.ok` / `<endpoint>.err` for the endpoints `tasklists.list`, `tasklists.get`, `tasklists.insert`, `tasklists.update`, `tasklists.patch`, `tasklists.delete`, `tasks.list`, `tasks.list.page2`, `tasks.get`, `tasks.insert`, `tasks.update`, `tasks.patch`, `tasks.delete`, `tasks.clear`, `tasks.move`.
- Planted values: `PLANTED_GOOGLE_ACCESS_A`, `PLANTED_GOOGLE_REFRESH_A`, `PLANTED_ID_TOKEN_A` (unsigned JWT, `{"email":"a@example.com","email_verified":true,"hd":"example.com"}`), user email `a@example.com`.

- [ ] **Step 1: Write `scripts/record-fixtures.ts`.** It takes `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from a desktop-type OAuth client and runs a loopback OAuth flow on `http://127.0.0.1:<random>/` with the scope from Global Constraints. Then, against a throwaway task list named `fixture-recorder-<timestamp>`, it calls every endpoint once successfully and once with a bad id (404) or a bad body (400), refreshes once, revokes, and refreshes again (`invalid_grant`). It writes each fixture with `_provenance: "recorded"`, after replacing tokens, emails, etags and ids with planted values. It deletes the throwaway list at the end.
- [ ] **Step 2: Write seed fixtures** for every name above from Google's published API reference, each marked `_provenance: "docs"`, so later tasks aren't blocked.
- [ ] **Step 3: Write `test/fixtures/fixtures.test.ts`:**
  - `every_fixture_parses` checks that each file matches the `Fixture` shape;
  - `no_unplanted_secrets` checks that no file contains `ya29.`, `1//` or `@gmail.com`;
  - `fixtures_are_recorded` lists every `docs`-provenance file. While any remain, it prints the list and skips, unless `REQUIRE_RECORDED_FIXTURES=1` is set, in which case it fails. It must pass with that variable set before merge.
- [ ] **Step 4: Run** `npm test`. Expected: pass, with `fixtures_are_recorded` reported as pending.
- [ ] **Step 5: HUMAN GATE (non-blocking).** Ask the user to run `npx tsx scripts/record-fixtures.ts` with a test Google account, then commit the recorded files over the seeds.
- [ ] **Step 6: Commit** `test: add Google fixture recorder and seed fixtures`.

### Task 3: Phase-0 characterisation goldens

**Files:**
- Create: `test/support/oauth-driver.ts`, `test/support/mcp-client.ts`, `test/characterisation/upstream.test.ts`, `test/characterisation/README.md`, `test/characterisation/__goldens__/`

**Interfaces:**
- Consumes: `GoogleFake`, fixtures.
- Produces:
  - `async function login(app: { fetch(r: Request): Promise<Response> }, google: GoogleFake, opts?: { idTokenFixture?: string }): Promise<{ clientId: string; redirectUri: string; tokens: { access_token: string; refresh_token?: string; expires_in: number } }>`. It drives register → authorize → callback → token with PKCE (verifier fixed to the RFC 7636 Appendix B value).
  - `async function mcp(app, accessToken: string, method: string, params?: unknown, id?: number): Promise<{ status: number; headers: Headers; messages: JSONRPCMessage[] }>`. It parses either an SSE body (`data:` lines) or a JSON body into JSON-RPC messages, so goldens survive the transport change in Task 6.

- [ ] **Step 1: Write `upstream.test.ts`** against today's `createApp`. It stubs `globalThis.fetch` with `GoogleFake.fetch` via `vi.stubGlobal` (a third-party edge) and sets `ENCRYPTION_SECRET` to a planted 64-hex value. For each of the 14 tools (`<tool>_ok` and `<tool>_google_error`), `tools/list`, `initialize`, the AS metadata document and the `/token` response shape, it asserts `expect(normalise(messages)).toMatchFileSnapshot("__goldens__/<name>.json")`. `normalise` replaces UUIDs, tokens and timestamps with stable markers.
- [ ] **Step 2: Write the README** saying these are **characterisation, not certification**, and that each golden is deleted in the task whose scenario certifies the same behaviour (named per golden in the README table).
- [ ] **Step 3: Run** `npx vitest run test/characterisation -u` once to write the goldens, then `npm test`. Expected: pass.
- [ ] **Step 4: Commit** `test: characterise upstream behaviour (phase 0 goldens)`.

### Task 4: `Store` interface and `DenoKvStore`; inject storage

**Files:**
- Create: `src/store/store.ts`, `src/store/denokv.ts`, `src/auth/oauth-store.ts`, `src/deps.ts`, `test/store/store.suite.ts`, `test/store/denokv.test.ts`, `test/support/test-server.ts`
- Modify: `src/auth/token-store.ts`, `src/auth/oauth.ts`, `src/server/rate-limiter.ts`, `src/server/middleware.ts`, `src/server/app.ts`, `src/index.ts`, `src/google/api.ts`

**Interfaces:**
- Produces:
  - `type Clock = () => number`.
  - `interface Store` exactly as in §5.1, plus `close(): Promise<void>`.
  - `class DenoKvStore implements Store { static open(opts: { path?: string; clock: Clock }): Promise<DenoKvStore> }`.
  - `interface AppDeps { store: Store; clock: Clock; oauthConfig: OAuthConfig; fetch: typeof fetch }`. `fetch` defaults to `globalThis.fetch`; Task 5 replaces `oauthConfig` with `config: Config`, and later tasks add fields.
  - `createApp(deps: AppDeps)`.
  - `createTokenStore(deps)`, `createOAuthStore(deps)`, `rateLimit(deps, cfg)`.
  - `async function startTestServer(overrides?: Partial<AppDeps>): Promise<{ app: Hono; deps: AppDeps; clock: TestClock; google: GoogleFake }>`, with an in-memory `DenoKvStore` and `fetch: google.fetch`.
- Stored value shape: `{ v: T, expiresAt: number | null }`. Reads treat `expiresAt !== null && expiresAt <= clock()` as absent. Backend TTL is set from `ttlMs` for garbage collection only.

- [ ] **Step 1: Write `test/store/store.suite.ts`**, exporting `runStoreSuite(name, make: (clock) => Promise<Store>, opts: { persistent: boolean; reopen?: () => Promise<Store> })`, with the §11.6 scenarios:
  - `read_after_write`, `delete_then_read`;
  - `expired_entry_invisible` (set with `ttlMs: 1000`, advance 1000 → `get`, `take` and `list` all miss);
  - `take_has_one_winner` (20 concurrent `take`s → exactly one non-null);
  - `list_by_prefix` (keys `["g","a","1"]`, `["g","a","2"]`, `["g","b","1"]`, `["h","a"]`; `list(["g","a"])` returns exactly the first two);
  - `survives_reopen` (persistent → present; non-persistent → **absent**, asserted);
  - `model_based_sequences` (fast-check `fc.commands` against a `Map` model, 100 runs).
- [ ] **Step 2: Write `denokv.test.ts`**, calling the suite twice: in-memory (`persistent: false`) and a temp-dir `path` (`persistent: true`). Run. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `DenoKvStore`.** `take` uses `kv.atomic().check(entry).delete(key).commit()` and retries on a failed check until the key is gone. `list` uses `kv.list({ prefix })` and filters expired entries.
- [ ] **Step 4: Run** the store tests. Expected: pass.
- [ ] **Step 5: Move storage onto the interface.** `OAuthStore` moves to `oauth-store.ts` over `Store`. `token-store.ts`, `rate-limiter.ts` and `middleware.ts` take deps. `oauth.ts` and `google/api.ts` get stores and `fetch` from deps (thread a `deps` argument through `registerAllTools` for now; Task 8 replaces it). `src/index.ts` builds `AppDeps` with `DenoKvStore.open({ path: process.env.KV_PATH, clock: Date.now })`. Point `test/characterisation` at `startTestServer` (no global stub needed any more).
- [ ] **Step 6: Run** `npm test && npm run typecheck`. Expected: all goldens unchanged.
- [ ] **Step 7: Commit** `feat: add Store interface with DenoKvStore and optional KV_PATH`.

### Task 5: Config module and Node entrypoint

**Files:**
- Modify: `src/config.ts`, `src/deps.ts`, `src/index.ts`, `package.json` (scripts `start: node build/node.js`)
- Create: `src/node.ts`, `test/unit/config.test.ts`, `test/node-entry.test.ts`

**Interfaces:**
- Produces:
  - `interface Config { google: OAuthConfig; issuerUrl?: string; storage: "denokv" | "firestore"; kvPath?: string; firestoreDatabase?: string; cipher: "static" | "gcpkms"; encryptionSecret?: string; kmsKeyName?: string; allowedDomain?: string; trustProxyHops?: number; publicPages: boolean; port: number; allowedOrigins: string[] }`.
  - `function loadConfig(env: Record<string, string | undefined>): Config`, which throws `ConfigError` with a message naming the variable.
  - `async function buildDeps(config: Config): Promise<AppDeps>`. `AppDeps.oauthConfig` becomes `AppDeps.config: Config`. `setOAuthConfig` and `getOAuthConfig` are deleted.

- [ ] **Step 1: Write `config.test.ts`:**
  - `defaults_match_upstream`: `{GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ENCRYPTION_SECRET}` only → `storage "denokv"`, `cipher "static"`, `publicPages true`, `port 3000`, redirect `http://localhost:3000/callback`, no `issuerUrl`/`allowedDomain`/`trustProxyHops`;
  - `gcpkms_requires_key`: `CIPHER=gcpkms` without `KMS_KEY_NAME` → throws mentioning `KMS_KEY_NAME`;
  - `static_requires_secret`: missing or short (< 32 chars) `ENCRYPTION_SECRET` → throws;
  - `firestore_requires_database`;
  - `issuer_url_must_be_https_or_localhost`;
  - `trust_proxy_hops_positive_int`;
  - `public_pages_parses_false`;
  - `unknown_storage_rejected`.
- [ ] **Step 2: Run.** Expected: FAIL. **Implement** `loadConfig` (`firestore` and `gcpkms` validate here, but `buildDeps` throws `not available until Task 13` for them for now). Run. Expected: pass.
- [ ] **Step 3: Write `node-entry.test.ts`** (`node_entry_serves_health`): call `startNodeServer({ ...config, port: 0 })` and `GET http://127.0.0.1:<port>/health` → 200. Then implement `export async function startNodeServer(config: Config): Promise<{ port: number; close(): Promise<void> }>` in `src/node.ts` with `@hono/node-server`'s `serve({ fetch, port })`; the module's main block calls it with `loadConfig(process.env)`. Run. Expected: pass.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`. Expected: pass; `build/node.js` and `build/index.js` exist.
- [ ] **Step 5: Commit** `feat: add config module and Node entrypoint`.

### Task 6: Stateless Streamable HTTP transport

**Files:**
- Modify: `src/server/mcp-endpoints.ts`, `src/server/app.ts` (routes `GET|POST|DELETE /mcp`; add `DELETE` to CORS `allowMethods`), `package.json` (`@modelcontextprotocol/sdk: ^1.27.1`)
- Delete: `src/transport/mcp-transport.ts`
- Create: `test/oauth/transport.test.ts`

**Interfaces:**
- Produces: `function handleMcp(deps: AppDeps): (c: Context) => Promise<Response>`. Per request it builds `new McpServer({ name: "google-tasks-mcp", version: "1.0.0" }, { capabilities: { tools: {} } })`, registers the tools, connects `new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` and returns `transport.handleRequest(c.req.raw)`. It closes the server and transport after the response.

- [ ] **Step 1: Write `transport.test.ts`:**
  - `stateless_across_instances`: two `startTestServer` apps sharing one store; login on A, then `initialize` on A and `tools/call list_task_lists` on B both succeed, with `content-type` `application/json` and no `mcp-session-id` sent or required;
  - `notification_accepted`: `notifications/initialized` → 202 with an empty body;
  - `tools_list_has_14`: names equal the 14 tool names in §2.
- [ ] **Step 2: Run.** Expected: FAIL (SSE content type). **Implement** `handleMcp`, delete the transport file, and drop `Mcp-Session-Id` from the CORS headers only if the SDK doesn't emit it. Run. Expected: pass; the characterisation goldens still pass, because `mcp()` normalises framing.
- [ ] **Step 3: Commit** `feat: use SDK stateless Streamable HTTP transport`.

### Task 7: `TokenCipher` and `StaticCipher`

**Files:**
- Create: `src/crypto/cipher.ts`, `src/crypto/static.ts`, `test/legacy_ref/encryption.ts` (byte-for-byte copy of upstream `src/utils/encryption.ts` at `0676ac8`), `test/unit/static-cipher.test.ts`
- Modify: `src/auth/token-store.ts` (async encrypt/decrypt via `deps.cipher`), `src/deps.ts` (`cipher: TokenCipher`)
- Delete: `src/utils/encryption.ts`

**Interfaces:**
- Produces: `interface TokenCipher` as in §5.2, and `class StaticCipher implements TokenCipher { constructor(secret: string) }`, which derives the key once (PBKDF2-SHA256, 100,000 iterations, salt `"google-tasks-mcp-salt"`, 32 bytes) and keeps the output format `base64(salt64 ‖ iv16 ‖ tag16 ‖ ct)`.

- [ ] **Step 1: Write `static-cipher.test.ts`:**
  - `roundtrip` (fast-check `fc.fullUnicodeString()`);
  - `tamper_throws` (flip any one byte after offset 64 → rejects);
  - `wrong_key_throws`;
  - `legacy_ciphertext_decrypts` (oracle rank 3: `legacy_ref.encrypt` with `ENCRYPTION_SECRET` set → `StaticCipher.decrypt` equals the plaintext, 50 fast-check cases);
  - `new_ciphertext_legacy_decrypts` (the reverse direction).
- [ ] **Step 2: Run** (FAIL), **implement**, run (pass), then `npm test`. Expected: goldens unchanged.
- [ ] **Step 3: Commit** `feat: add TokenCipher interface; derive static key once`.

### Task 8: Google client seam and tool scenarios

**Files:**
- Create: `src/google/client.ts`, `src/google/oauth.ts` (move `refreshGoogleToken` out of `auth/oauth.ts`; add `exchangeCode`, `revokeGoogleToken`), `test/tools/tools.test.ts`
- Modify: `src/google/api.ts`, `src/tools/index.ts`, `src/tools/tasklists.ts`, `src/tools/tasks.ts`, `src/server/mcp-endpoints.ts`

**Interfaces:**
- Produces:
  - `interface GoogleClient { getAccessToken(): Promise<string>; fetch: typeof fetch }`.
  - Each API function's first parameter changes from `mcpToken: string` to `client: GoogleClient`; names, URLs and other parameters are unchanged.
  - `registerAllTools(server: McpServer, client: GoogleClient)`.
  - `exchangeCode(deps, code: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; idToken?: string }>`.
  - `refreshGoogleToken(deps, refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>`, which throws `GoogleInvalidGrantError` on `invalid_grant`.
  - `revokeGoogleToken(deps, token: string): Promise<void>`.
  - For now, `mcp-endpoints.ts` builds the client from the existing token store; Task 10 replaces that.

- [ ] **Step 1: Write `tools.test.ts`** (oracle: recorded reality; readable timestamps recomputed independently in the test with `new Date(v).toLocaleString()` under `TZ=UTC`):
  - `<tool>_ok` × 14, table-driven over `{ tool, args, fixture, method, path, query? }`: the Google call has that method, path and query, and the result text parses to the fixture body plus the `*_readable` fields;
  - `<tool>_google_error` × 14: `isError: true`, the text contains the fixture's status and Google's `error.message`, HTTP 200;
  - `tool_invalid_args`: `get_task` without `taskId` → JSON-RPC error or `isError` from SDK validation, and `google.calls` is empty;
  - `two_users_isolated`: users A and B log in with distinct planted Google tokens; each user's calls carry only `Bearer PLANTED_GOOGLE_ACCESS_<user>`;
  - `unicode_long_title_roundtrip` (Review Focus 3): `insert_task` with a 2,000-character title mixing emoji and CJK; the Google request body's `title` equals the input exactly;
  - `list_tasks_paged` (Review Focus 5): `list_tasks { pageToken: "P2" }` sends `pageToken=P2` and returns `nextPageToken` from `tasks.list.page2`.
- [ ] **Step 2: Run** (FAIL on signatures), **implement**, run (pass). Delete the `<tool>_*` goldens now certified, and update the characterisation README.
- [ ] **Step 3: Commit** `refactor: inject Google client into API and tools; add tool scenarios`.

### Task 9: `/authorize` validation, protected-resource metadata, `ISSUER_URL`

**Files:**
- Modify: `src/auth/oauth.ts`, `src/server/app.ts`, `src/server/middleware.ts`
- Create: `src/auth/tokens.ts`, `test/oauth/authorize.test.ts`, `test/oauth/discovery.test.ts`, `test/unit/pkce.test.ts`

**Interfaces:**
- Produces:
  - `function issuer(deps, req: Request): string`, which returns `config.issuerUrl ?? new URL(req.url).origin`.
  - `function pkceS256(verifier: string): string`, exported from `src/auth/tokens.ts`.
  - Every 401 from `/mcp` carries `WWW-Authenticate: Bearer resource_metadata="<issuer>/.well-known/oauth-protected-resource/mcp"`.
  - `GET /.well-known/oauth-protected-resource` and `GET /.well-known/oauth-protected-resource/mcp` both return `{ resource: "<issuer>/mcp", authorization_servers: ["<issuer>"], bearer_methods_supported: ["header"] }`.

- [ ] **Step 1: Write the tests:**
  - `pkce.test.ts`, `rfc7636_vector`: `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` → `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`;
  - `discovery.test.ts`:
    - `discovery_documents`: AS metadata has `code_challenge_methods_supported: ["S256"]`, a `registration_endpoint`, and `refresh_token` in `grant_types_supported`; PRM at both paths with `resource = ISSUER/mcp`;
    - `issuer_url_pins_issuer`: with `ISSUER_URL=https://<host>`, requests to `http://internal` still advertise `https://<host>`;
    - `mcp_without_bearer`: 401 with `resource_metadata`;
  - `authorize.test.ts`:
    - `unregistered_redirect_uri`: 400 and no `Location`;
    - `unknown_client_id`: 400 and no redirect;
    - `pkce_mismatch`: `invalid_grant`, no tokens;
    - `auth_code_replay`: second exchange `invalid_grant`;
    - `login_across_instances` (Review Focus 2): authorize on app A, then callback and token on app B sharing the store → success.
- [ ] **Step 2: Run** (FAIL), **implement** (auth codes are consumed with `store.take`), run (pass). Delete the AS-metadata golden.
- [ ] **Step 3: Commit** `feat: validate client and redirect at /authorize; serve protected-resource metadata`.

### Task 10: Token model, refresh grant with rotation, Google refresh on call

**Files:**
- Create: `test/oauth/refresh.test.ts`, `test/oauth/login.test.ts`
- Modify: `src/auth/tokens.ts` (add `randomToken`, `hashToken`), `src/auth/token-store.ts` (rewrite), `src/auth/oauth.ts` (`/callback` exchanges with Google; `/token` handles both grants), `src/server/middleware.ts`, `src/google/client.ts`, `src/server/mcp-endpoints.ts`

**Interfaces:**
- Produces:
  - `randomToken(): string` (32 random bytes, base64url) and `hashToken(t: string): string` (sha256 hex).
  - `interface Grant { email?: string; clientId: string; encGoogleAccess: string; encGoogleRefresh: string; googleExpiresAt: number; createdAt: number }`.
  - Token store:
    - `createGrant(g): Promise<{ grantId: string }>`;
    - `issuePair(grantId): Promise<{ accessToken: string; refreshToken: string }>`;
    - `resolveAccess(token): Promise<{ grantId: string; grant: Grant } | null>`;
    - `rotateRefresh(token, clientId): Promise<{ accessToken: string; refreshToken: string } | { error: "invalid_grant" }>`;
    - `getGoogleAccess(grantId): Promise<string>`;
    - `revokeGrant(grantId): Promise<void>`;
    - `listGrants(email?: string): Promise<Array<{ grantId: string; grant: Grant }>>`.
  - `createGoogleTokenProvider(deps): (grantId: string) => GoogleClient`, which holds the in-memory per-grant cache.
  - The middleware sets `c.set("grantId", …)`.
- Keys (all secrets hashed): `grants/{grantId}`, `access/{hash}` → `{grantId}` (1 h), `refresh/{hash}` → `{grantId, clientId}` (30 d), `refresh_used/{hash}` → `{grantId, usedAt}` (30 d), `grants_by_email/{email}/{grantId}` → `{}`. `grantId` comes from `crypto.randomUUID()`.
- Auth code record (10 min): `{ clientId, redirectUri, codeChallenge, email?, encGoogleAccess, encGoogleRefresh, googleExpiresAt }`. The Google code is exchanged at `/callback`, so `/callback` can see the `id_token` (needed by Task 11). The grant is created at `/token`.

`rotateRefresh` algorithm (atomic via `take`, since `Store` has no compare-and-set; equivalent to §5.3's "mark used"):
```
rec = take(refresh/h)
if rec:
  if rec.clientId != clientId: set(refresh/h, rec, remaining ttl); return invalid_grant
  if !get(grants/rec.grantId): return invalid_grant
  set(refresh_used/h, {grantId, usedAt: now}, 30d); extend grant + grants_by_email to 30d
  return issuePair(rec.grantId)
used = get(refresh_used/h)
if !used: return invalid_grant                       # unknown, or concurrent loser before marker
if now - used.usedAt <= 60_000: return invalid_grant # grace: keep grant
revokeGrant(used.grantId); return invalid_grant      # reuse after grace
```

- [ ] **Step 1: Write `login.test.ts`:**
  - `full_login` (recorded token exchange): register → authorize 302 to Google with scope `openid email https://www.googleapis.com/auth/tasks`, `access_type=offline` and `prompt=consent` → callback 302 to the client with the code and original state → token (PKCE) returns `expires_in: 3600` plus a `refresh_token` → `tools/list` returns 14 tools;
  - `store_holds_no_raw_tokens`: after login, no Store key or value contains the access token, the refresh token or `PLANTED_GOOGLE_*`.
- [ ] **Step 2: Write `refresh.test.ts`:**
  - `refresh_rotation`: new pair; the new access token works; the old refresh token gets `invalid_grant`;
  - `refresh_wrong_client`: B presents A's refresh token → `invalid_grant`, and A can still refresh with it;
  - `refresh_reuse_in_grace`: rotate, advance 59 s, reuse → `invalid_grant`; the latest access token still works;
  - `refresh_reuse_after_grace`: rotate, advance 61 s, reuse → `invalid_grant`; the latest access token → 401;
  - `refresh_concurrent` (Review Focus 4): two parallel `/token` refreshes with the same token → exactly one 200; the grant still works;
  - `access_token_expiry`: advance 61 min → 401; a refresh then succeeds;
  - `google_token_refresh_on_call`: grant with `googleExpiresAt` in the past; queue `token.refresh.ok` → the tool succeeds, and the Tasks call carries the refreshed token;
  - `google_invalid_grant`: queue `token.refresh.invalid_grant` → 401 on `/mcp`, and the grant is gone from the Store;
  - `google_token_cached`: two tool calls within 5 min → one cipher decrypt (count via a wrapping `TokenCipher` in the test, which is a test double for our own interface, not a mock of `src/`).
- [ ] **Step 3: Run** (FAIL), **implement**, run (pass). Delete the `/token` golden.
- [ ] **Step 4: Commit** `feat: hashed token keys, rotating refresh tokens, 1h access tokens`. Add this to the body: `BREAKING for existing deployments: tokens issued before this change stop working; users reconnect once.`

### Task 11: `ALLOWED_DOMAIN`, `TRUST_PROXY_HOPS`, `PUBLIC_PAGES`

**Files:**
- Create: `src/auth/id-token.ts`, `test/oauth/domain.test.ts`, `test/oauth/rate-limit.test.ts`, `test/unit/client-ip.test.ts`, `test/pages.test.ts`
- Modify: `src/auth/oauth.ts`, `src/server/rate-limiter.ts`, `src/server/app.ts`

**Interfaces:**
- Produces:
  - `parseIdToken(jwt: string): { email?: string; email_verified?: boolean; hd?: string }`, which base64url-decodes the payload with no signature check (§5.4).
  - `clientIp(headers: Headers, hops?: number): string`: with no `hops`, the first `X-Forwarded-For` value, else `x-real-ip`, else `"unknown"` (upstream); with `hops = n`, the n-th entry from the right, falling back to the leftmost entry when the header is shorter.

- [ ] **Step 1: Write the tests** (oracle: planted truth). Each scenario queues a token exchange with a planted `id_token`.
  - `domain.test.ts`:
    - `wrong_domain`: `ALLOWED_DOMAIN=example.com`, `hd=gmail.com` → 403 `text/plain`, nothing stored, and `hd=example.com` on the Google redirect;
    - `unverified_email` → 403;
    - `id_token_without_hd` (Review Focus 1) → 403;
    - `domain_unset_open`: no `ALLOWED_DOMAIN`, gmail `id_token` → login succeeds, with no `hd` on the redirect;
    - `error_params_not_echoed`: `/callback?error=<script>` → the body doesn't contain `<script>`;
  - `client-ip.test.ts`: examples for `hops` unset, 1 and 2, plus a short header;
  - `rate-limit.test.ts`, `register_rate_limit`: 31 registrations with `TRUST_PROXY_HOPS=1`, a changing spoofed leftmost XFF and a constant rightmost → the 31st is 429;
  - `pages.test.ts`:
    - `public_pages_false`: `/` is JSON, `/privacy-policy` is 404, and no response CSP contains `googletagmanager`;
    - `public_pages_default`: `/` serves `public/index.html`.
- [ ] **Step 2: Run** (FAIL), **implement**, run (pass). Delete the remaining goldens that are now certified. If none remain, delete `test/characterisation/` and say so in the commit.
- [ ] **Step 3: Commit** `feat: optional Workspace domain restriction, trusted proxy hops, PUBLIC_PAGES`.

### Task 12: Revoke command

**Files:**
- Create: `src/cli/revoke.ts`, `test/cli/revoke.test.ts`
- Modify: `package.json` (`"revoke": "node build/cli/revoke.js"`)

**Interfaces:**
- Consumes: `loadConfig`, `buildDeps`, the token store's `listGrants` and `revokeGrant`, and `revokeGoogleToken`.
- Produces: `async function runRevoke(deps: AppDeps, args: { email?: string; all?: boolean; dryRun?: boolean }, out: (line: string) => void): Promise<number>`, which returns the count. The CLI is `--email <addr> | --all [--dry-run]`; it exits 2 when neither `--email` nor `--all` is given. A failed Google revoke is logged and the grant is still deleted.

- [ ] **Step 1: Write `revoke.test.ts`:**
  - `revoke_one_user`: planted users A and B; `--email a@example.com` → A's tokens 401, B's tools work, one revoke call carrying A's planted Google refresh token, prints `revoked 1`;
  - `revoke_all`: A, B, C → all 401, three revoke calls, `revoked 3`;
  - `dry_run_changes_nothing`;
  - `google_revoke_failure_still_deletes`.
- [ ] **Step 2: Run** (FAIL), **implement**, run (pass), then `npm run build && node build/cli/revoke.js` → exit code 2 with usage.
- [ ] **Step 3: Commit** `feat: add revoke command (kill switch)`.

### Task 13: gcloud option: `FirestoreStore` and `KmsCipher`

**Files:**
- Create: `src/store/firestore.ts`, `src/crypto/kms.ts`, `test/store/firestore.test.ts`, `test/unit/firestore-key.test.ts`, `test/unit/kms-cipher.test.ts`, `test/support/kms-fake.ts`, `test/support/firestore-emulator.ts`
- Modify: `src/deps.ts` (lazy `await import()` of both SDKs when selected), `package.json` (`optionalDependencies`: `@google-cloud/firestore`, `@google-cloud/kms`), `vitest.config.ts` (emulator global setup)

**Interfaces:**
- Produces:
  - `class FirestoreStore implements Store { constructor(db: Firestore, clock: Clock) }`;
  - `encodeDocId(parts: string[]): string` and `decodeDocId(id: string): string[]`;
  - `class KmsCipher implements TokenCipher { constructor(client: Pick<KeyManagementServiceClient, "encrypt" | "decrypt">, keyName: string) }`, whose ciphertext is `base64(kms ciphertext)`.
- Both throw `BackendUnavailableError` (new, in `src/store/store.ts`) when the SDK reports gRPC code 14 (`UNAVAILABLE`) or 4 (`DEADLINE_EXCEEDED`). `app.onError` maps it to **503** `{ error: "temporarily_unavailable" }` and logs it with the component tag (§7).
- Document shape: collection = `key[0]`, doc id = `encodeDocId(key.slice(1))`, fields `{ v, expiresAt: Timestamp | null }`. `undefined` is stripped before writes.
- `encodeDocId`: `encodeURIComponent` each part, then also replace `.` with `%2E` and `~` with `%7E`, and join with `~`. `list(prefix)` with more than one part does a range query on `FieldPath.documentId()` from `enc + "~"` to `enc + "~"`; a single-part prefix lists the whole collection. `take` runs `get` + `delete` in `runTransaction`.

- [ ] **Step 1: Write `firestore-key.test.ts`:**
  - `roundtrip`: `fc.array(fc.fullUnicodeString({ minLength: 1 }), { minLength: 1, maxLength: 4 })`;
  - `no_collisions`: distinct arrays → distinct ids;
  - `prefix_order`: `enc(p)+"~"` sorts before the ids of every extension of `p`, and the ids of non-extensions fall outside the range.
- [ ] **Step 2: Write `kms-cipher.test.ts`** against `KmsFake`, which AES-GCM-encrypts under a random key and tags the `keyName`:
  - `roundtrip`;
  - `ciphertext_hides_plaintext`;
  - `tamper_throws`;
  - `wrong_key_name_throws`;
  - `kms_unavailable_503`: `KmsFake.failNext(14)`, then a tool call → `/mcp` returns 503 with a generic body, not 500.
- [ ] **Step 3: Write `firestore.test.ts`**, calling `runStoreSuite("firestore", …, { persistent: true })` against the emulator. `firestore-emulator.ts` starts `gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators` via Docker (`gcloud emulators firestore start --host-port=0.0.0.0:8080`) and sets `FIRESTORE_EMULATOR_HOST`. If Docker is unavailable, the suite fails with `Firestore emulator tier NOT RUN: docker unavailable` under `CI=true`, and otherwise prints that line and marks the suite skipped (§11.6: never silent).
- [ ] **Step 4: Run** (FAIL), **implement** both, run (pass, including the emulator tier locally).
- [ ] **Step 5: Wire up `buildDeps`.** `STORAGE=firestore` → `new Firestore({ databaseId: config.firestoreDatabase })`; `CIPHER=gcpkms` → `new KeyManagementServiceClient()`. Add `config_gcloud_builds` to `config.test.ts` with the emulator host set. Run `npm test`. Expected: pass.
- [ ] **Step 6: Commit** `feat: add gcloud option (FirestoreStore, KmsCipher)`.

### Task 14: Cross-cutting invariants

**Files:**
- Create: `test/support/invariants.ts`
- Modify: `test/support/test-server.ts` (register an `afterEach` that runs the invariants on every app started in the test)

**Interfaces:**
- Produces: `assertInvariants(rec: { responses: Array<{ path: string; status: number; headers: Headers; body: string }>; logs: string[]; storeDump: Array<{ key: string[]; value: unknown }>; secrets: string[] })`. `test-server.ts` wraps `app.fetch` to record responses, spies on `console.log|warn|error` to collect logs (`console` isn't `src/`), and gathers `secrets` from the planted Google tokens plus every `access_token` and `refresh_token` that `/token` issued.

- [ ] **Step 1: Implement the §11.8 invariants:**
  1. No body (except the issuing `/token` response) and no log line contains a secret.
  2. No store key or value contains a secret.
  3. Every 401 on `/mcp` has `resource_metadata` in `WWW-Authenticate`.
  4. Every response has `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy` and `Referrer-Policy`.
  5. No status 500.
- [ ] **Step 2: Run** `npm test`. Fix every violation in `src/`; extend the logger's `REDACTION_PATTERNS` for 43-character base64url tokens if invariant 1 needs it. Expected: all pass.
- [ ] **Step 3: Commit** `test: enforce security invariants across every HTTP scenario`.

### Task 15: Container, Terraform and docs (generic)

**Files:**
- Create:
  - `Dockerfile`, `.dockerignore`;
  - `infra/main.tf`, `infra/variables.tf`, `infra/outputs.tf`, `infra/versions.tf`, `infra/terraform.tfvars.example`, `infra/backend.hcl.example`;
  - `DEPLOY.md`, `MAINTAIN.md`, `docs/adr/adr-001-central-encrypted-token-store.md`.
- Modify: `.gitignore` (`infra/*.tfvars`, `!infra/terraform.tfvars.example`, `infra/backend.hcl`, `infra/.terraform/`), `README.md` (a "Self-hosting on GCP" section linking `DEPLOY.md`), `CLAUDE.md` (architecture updates)

**Interfaces:**
- Terraform variables: `project_id`, `region`, `service_name` (default `google-tasks-mcp`), `issuer_url`, `allowed_domain`, `custom_domain` (optional), `enable_custom_domain` (bool, default false), `image` (initial placeholder), `max_instances` (default 3).
- Outputs: `service_url`, `domain_dns_records`, `runtime_sa_email`, `deployer_sa_email`, `kms_key_name`.
- Resources: exactly the §8 table. Firestore TTL uses `google_firestore_field` with `ttl_config {}` on `expiresAt` for each of `grants`, `access`, `refresh`, `refresh_used`, `grants_by_email`, `oauth_sessions`, `auth_codes`, `rate_limit`. Cloud Run env is set from §6, with `lifecycle { ignore_changes = [template[0].containers[0].image] }`.

- [ ] **Step 1: Write `Dockerfile`.** Multi-stage `node:22-slim`: `npm ci`, `npm run build`, then a runtime stage with production deps, `build/` and `public/`; `ENV PORT=8080`; `CMD ["node", "build/node.js"]`. Run `docker build -t gtasks-mcp:test .`, then `docker run` with planted env and `curl /health`. Expected: 200.
- [ ] **Step 2: Write `infra/`.** Check the current google provider docs (Context7 or the registry) for `google_cloud_run_v2_service`, `google_cloud_run_domain_mapping`, `google_firestore_field` and `google_kms_crypto_key` before writing. Run `terraform -chdir=infra init -backend=false && terraform -chdir=infra validate`. Expected: `Success!`.
- [ ] **Step 3: Write `DEPLOY.md`** (generic, placeholders only), covering:
  - APIs and Terraform: `terraform init -backend-config=backend.hcl`, `plan -var-file=terraform.tfvars`;
  - OAuth consent screen (Internal);
  - an OAuth web client with redirect `<ISSUER_URL>/callback`;
  - secret versions;
  - `gcloud builds submit` or `docker push` to Artifact Registry with the commit-SHA tag, then `gcloud run deploy --image`;
  - domain verification and the DNS CNAME;
  - the no-browser checks (curl both PRM URLs and the AS metadata; `POST /mcp` without a bearer → 401 with `resource_metadata`).
- [ ] **Step 4: Write `MAINTAIN.md`** (endpoints, config table from §6, the revoke runbook using `npm run revoke`, rotating the Google client secret, KMS rotation notes, connector gotchas). **Write ADR-001** (context, decision, consequences, and the rule "identity-only scopes → pass-through; user-data scopes → central encrypted store", with no references to private repos).
- [ ] **Step 5: Run the org-term scan** kept in the deployer's private plan (it isn't listed here, by design). Expected: no matches. Then run `npm test && npm run typecheck`.
- [ ] **Step 6: Commit** `feat: add Dockerfile, Terraform and deployment docs`.

---

## After this plan

The deployment to a specific project (real `terraform.tfvars`, `backend.hcl`, first deploy, the AC8 connection checks from Claude web, Claude Code and `mcp-remote`) and the upstream issue/PRs are tracked in the deployer's private plan. They aren't part of this repo.
