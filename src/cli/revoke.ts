#!/usr/bin/env node
// Kill switch: revoke one user's grants, or everyone's.
//
//   npm run revoke -- --email <addr> [--dry-run]
//   npm run revoke -- --all [--dry-run]
//
// Runs with the same environment as the server (STORAGE, CIPHER, ...) and an
// admin's credentials for the store and key.

import process from "node:process";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.ts";
import { type AppDeps, buildDeps } from "../deps.ts";
import { createTokenStore } from "../auth/token-store.ts";
import { revokeGoogleToken } from "../google/oauth.ts";

export interface RevokeArgs {
  email?: string;
  all?: boolean;
  dryRun?: boolean;
}

export async function runRevoke(deps: AppDeps, args: RevokeArgs, out: (line: string) => void): Promise<number> {
  const tokens = createTokenStore(deps);
  const grants = await tokens.listGrants(args.all ? undefined : args.email);
  for (const { grantId, grant } of grants) {
    const who = `${grant.email ?? "(no email)"} grant ${grantId}`;
    if (args.dryRun) {
      out(`would revoke ${who}`);
      continue;
    }
    try {
      await revokeGoogleToken(deps, await deps.cipher.decrypt(grant.encGoogleRefresh));
    } catch (error) {
      // The grant is deleted regardless: our side of the kill switch must hold.
      out(`warning: Google revoke failed for ${who}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await tokens.revokeGrant(grantId);
    out(`revoked ${who}`);
  }
  out(args.dryRun ? `would revoke ${grants.length} (dry run)` : `revoked ${grants.length}`);
  return grants.length;
}

export function parseRevokeArgs(argv: string[]): RevokeArgs | null {
  const args: RevokeArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") args.all = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--email" && argv[i + 1]) args.email = argv[++i];
    else return null;
  }
  if (!!args.all === !!args.email) return null;
  return args;
}

const USAGE = "usage: npm run revoke -- (--email <addr> | --all) [--dry-run]";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseRevokeArgs(process.argv.slice(2));
  if (!args) {
    console.error(USAGE);
    process.exit(2);
  }
  const deps = await buildDeps(loadConfig(process.env));
  try {
    await runRevoke(deps, args, (line) => console.log(line));
  } finally {
    await deps.store.close();
  }
}
