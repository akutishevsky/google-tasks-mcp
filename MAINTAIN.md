# Operating google-tasks-mcp

## Endpoints

| Path | Purpose |
|------|---------|
| `POST /mcp` | MCP, stateless Streamable HTTP (JSON responses). `GET`/`DELETE` → 405 |
| `/register`, `/authorize`, `/callback`, `/token` | OAuth 2.1 + PKCE for MCP clients |
| `/.well-known/oauth-authorization-server` | Authorization server metadata |
| `/.well-known/oauth-protected-resource[/mcp]` | Protected-resource metadata |
| `/health` | Liveness |

## Configuration

| Env var | Default | Notes |
|---------|---------|-------|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | required | OAuth web client |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/callback` | `<ISSUER_URL>/callback` |
| `ISSUER_URL` | request origin | Set it behind any proxy (Cloud Run sees `http`) |
| `STORAGE` | `denokv` | `firestore` for the gcloud option |
| `KV_PATH` | unset | Deno KV file on Node. **Unset on Node = in memory**: every restart logs everyone out |
| `FIRESTORE_DATABASE` | — | Required with `STORAGE=firestore` |
| `CIPHER` | `static` | `gcpkms` for Cloud KMS |
| `ENCRYPTION_SECRET` | required for `static` | ≥ 32 chars |
| `KMS_KEY_NAME` | — | Required with `CIPHER=gcpkms` |
| `ALLOWED_DOMAIN` | unset (any account) | Workspace domain; checks `hd` + `email_verified` |
| `ALLOWED_REDIRECT_URIS` | unset (any https/loopback URI) | Comma-separated exact https URIs, or `loopback`. Set it on shared deployments: otherwise anyone can register a redirect and phish a code |
| `TRUST_PROXY_HOPS` | unset | `1` on Cloud Run (rate-limit by real client IP) |
| `PUBLIC_PAGES` | `true` | `true` serves the HTML pages, `false` plain JSON, `auto` HTML to browsers (`Accept: text/html`) and JSON to everything else |
| `ANALYTICS` | `true` | `false` strips the pages' Google Analytics tag and drops it from the CSP. Set it on your own deployment: the tag reports to the upstream project |
| `PRIVACY_POLICY_URL` | unset | https URL; `/privacy-policy` redirects there instead of serving the bundled page |
| `PORT`, `LOG_LEVEL`, `ALLOWED_ORIGINS` | `3000`, `info`, unset | |

Startup fails fast on an invalid combination.

## Tokens

- Clients get a 1-hour access token and a 30-day refresh token, rotated on each
  use. Reusing a refresh token more than 60 s after rotation revokes the whole
  grant (assumed stolen); within 60 s it is refused but the grant is kept.
- Google tokens stay server-side, encrypted (KMS or `ENCRYPTION_SECRET`).
  Store keys are SHA-256 hashes of our tokens.
- If Google refuses a refresh (user removed access, account suspended), the grant
  is deleted and the client is asked to sign in again.

## Upgrading an existing deployment

- **Everyone reconnects once.** Our tokens are now stored under SHA-256 hashes,
  so tokens issued by an older version are no longer found: clients get a 401
  and sign in again. Keep the same `ENCRYPTION_SECRET`; the stored Google token
  format is unchanged.
- **Clients must use PKCE (S256)** and register their redirect URI. Claude and
  `mcp-remote` already do.
- **Deno Deploy keeps working** with the same environment variables; nothing new
  is required.

## Logs worth knowing

| Log line | Meaning |
|----------|---------|
| `MCP request rejected` (with `reason`) | The MCP transport answered 400, e.g. an unsupported protocol version |
| `Google refused the refresh token; revoking grant` | The user removed access or the account was suspended; they sign in again |
| `Client registration rejected: redirect_uri not allowed` | `ALLOWED_REDIRECT_URIS` blocked a client |
| `Authentication failed: missing or invalid Authorization header` | Normal when a client's access token expires; it refreshes and retries |

## Revoking access (kill switch)

Run with the same environment as the service and credentials that can read
Firestore and decrypt with the KMS key:

```bash
export STORAGE=firestore FIRESTORE_DATABASE=<db> CIPHER=gcpkms KMS_KEY_NAME=<key> \
       GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_CLOUD_PROJECT=<project>
npm run build
npm run revoke -- --email someone@<domain> --dry-run
npm run revoke -- --email someone@<domain>
npm run revoke -- --all            # everyone
```

Each grant's Google refresh token is revoked at Google, then the grant is
deleted. A failed Google revoke is reported, and the grant is deleted anyway.

## Rotation

- **KMS key**: rotates automatically every 90 days; old versions keep
  decrypting. No re-encryption job is needed.
- **Google client secret**: add a new secret version, redeploy (Cloud Run reads
  `latest` at instance start), then delete the old secret in the console.
- **`ENCRYPTION_SECRET`** (static cipher only): changing it makes stored tokens
  unreadable; everyone reconnects.

## Connector gotchas

- The issuer and redirect URI are part of every connection. Changing the
  hostname forces everyone to reconnect.
- Claude's connectors cannot pass Cloudflare Access or custom auth headers; the
  endpoint must be publicly reachable, with OAuth as the gate.
- A 401 from `/mcp` carries `WWW-Authenticate: Bearer resource_metadata=…`,
  which is what tells clients to (re)start OAuth.
