import type { Store } from "../../src/store/store.ts";

// Every collection the server writes. A new collection must be added here so
// invariants can inspect it.
export const COLLECTIONS = [
  "grants",
  "access",
  "refresh",
  "refresh_used",
  "grants_by_email",
  "revoked",
  "oauth_sessions",
  "auth_codes",
  "clients",
  "rate_limit",
  "tokens",
];

export async function dumpStore(store: Store): Promise<Array<{ key: string[]; value: unknown }>> {
  const out: Array<{ key: string[]; value: unknown }> = [];
  for (const c of COLLECTIONS) out.push(...(await store.list([c])));
  return out;
}
