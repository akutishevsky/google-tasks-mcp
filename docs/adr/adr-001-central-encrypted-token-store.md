# ADR-001: Central encrypted token store

* **Status**: Accepted, 2026.W42 (2026-10-17)
* **Context**: GCP deployment design, `docs/specs/2026-10-17-gcp-deployment-design.md`

## Context

A remote MCP server that calls a Google API on each user's behalf needs that
user's Google OAuth tokens. Two models exist:

1. **Pass-through.** The MCP client holds Google's tokens and sends them with
   each request; the server stores nothing.
2. **Central store.** The server keeps Google's tokens, encrypted, and gives the
   client only its own opaque tokens.

Upstream already uses the central store (Deno KV, AES-GCM with a static secret).

## Decision

Keep the central store, hardened:

- Our tokens are random 256-bit values; store keys are their SHA-256 hashes.
- Access tokens last 1 hour; refresh tokens 30 days, rotated on every use, with
  reuse detection (60 s grace, then the grant is revoked).
- Google tokens are encrypted with a pluggable cipher: the static secret
  (upstream) or Cloud KMS per token.
- An operator command revokes one user or everyone.

## Consequences

- Google refresh tokens never reach client devices (some clients store tokens in
  plaintext), and a compromised client cannot call Google directly.
- There is a central kill switch.
- The server holds credentials, so a leak of the store must not expose them:
  with KMS, the store alone holds no usable secret.
- It stays close to upstream, so changes can be contributed back.

## Rule of thumb for other MCP servers

- Scopes that only establish identity (`openid email`): pass-through is enough;
  there is nothing worth stealing.
- Scopes that reach user data (Tasks, Drive, Gmail, …): use a central encrypted
  store like this one.
