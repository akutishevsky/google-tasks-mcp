// Token model (design §5.3). Clients hold only our opaque access and refresh
// tokens; Google's tokens stay here, encrypted. Store keys use SHA-256 hashes
// of our tokens, so the store's keys are not usable as bearer tokens.
import type { AppDeps } from "../deps.ts";
import { hashToken, randomToken } from "./tokens.ts";

export interface Grant {
  email?: string;
  clientId: string;
  encGoogleAccess: string;
  encGoogleRefresh: string;
  googleExpiresAt: number;
  createdAt: number;
  /** when the grant (and its refresh tokens) lapse; extended on each rotation */
  expiresAt: number;
}

interface RefreshRecord {
  grantId: string;
  clientId: string;
  expiresAt: number;
}

interface RefreshUsed {
  grantId: string;
  usedAt: number;
}

export const ACCESS_TTL_MS = 60 * 60 * 1000; // 1 h
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 d
export const REUSE_GRACE_MS = 60 * 1000;

const grantKey = (id: string) => ["grants", id];
const revokedKey = (id: string) => ["revoked", id];
const byEmailKey = (email: string, id: string) => ["grants_by_email", email, id];
const accessKey = (t: string) => ["access", hashToken(t)];
const refreshKey = (t: string) => ["refresh", hashToken(t)];
const usedKey = (t: string) => ["refresh_used", hashToken(t)];

export type TokenPair = { accessToken: string; refreshToken: string };
export type TokenStore = ReturnType<typeof createTokenStore>;

export function createTokenStore(deps: Pick<AppDeps, "store" | "cipher" | "clock">) {
  const { store, cipher, clock } = deps;

  /**
   * Store has no compare-and-set, so a write can race a revoke (read grant →
   * revoke → write grant back). revokeGrant writes a tombstone before deleting;
   * saveGrant writes, then checks the tombstone and undoes its own write. In
   * every interleaving one of the two deletes runs after the write.
   */
  async function saveGrant(grantId: string, grant: Grant): Promise<void> {
    const ttlMs = grant.expiresAt - clock();
    await store.set(grantKey(grantId), grant, { ttlMs });
    if (grant.email) await store.set(byEmailKey(grant.email, grantId), {}, { ttlMs });
    if (await store.get(revokedKey(grantId))) await deleteGrant(grantId, grant.email);
  }

  async function deleteGrant(grantId: string, email?: string): Promise<void> {
    await store.delete(grantKey(grantId));
    if (email) await store.delete(byEmailKey(email, grantId));
  }

  async function createGrant(g: {
    email?: string;
    clientId: string;
    encGoogleAccess: string;
    encGoogleRefresh: string;
    googleExpiresAt: number;
  }): Promise<{ grantId: string }> {
    const grantId = crypto.randomUUID();
    const now = clock();
    await saveGrant(grantId, { ...g, createdAt: now, expiresAt: now + REFRESH_TTL_MS });
    return { grantId };
  }

  async function getGrant(grantId: string): Promise<Grant | null> {
    const grant = await store.get<Grant>(grantKey(grantId));
    if (!grant) return null;
    return (await store.get(revokedKey(grantId))) ? null : grant;
  }

  async function issuePair(grantId: string, clientId: string): Promise<TokenPair> {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    await store.set(accessKey(accessToken), { grantId }, { ttlMs: ACCESS_TTL_MS });
    const rec: RefreshRecord = { grantId, clientId, expiresAt: clock() + REFRESH_TTL_MS };
    await store.set(refreshKey(refreshToken), rec, { ttlMs: REFRESH_TTL_MS });
    return { accessToken, refreshToken };
  }

  async function resolveAccess(accessToken: string): Promise<{ grantId: string; grant: Grant } | null> {
    const rec = await store.get<{ grantId: string }>(accessKey(accessToken));
    if (!rec) return null;
    const grant = await getGrant(rec.grantId);
    return grant ? { grantId: rec.grantId, grant } : null;
  }

  async function revokeGrant(grantId: string): Promise<void> {
    const grant = await store.get<Grant>(grantKey(grantId));
    // Tombstone first (outlives any refresh token of this grant), then delete.
    await store.set(revokedKey(grantId), { at: clock() }, { ttlMs: REFRESH_TTL_MS });
    await deleteGrant(grantId, grant?.email);
  }

  /**
   * Rotation with reuse detection. Store has no compare-and-set, so "mark the
   * refresh record used" is an atomic take plus a used marker: exactly one
   * concurrent caller wins the take.
   */
  async function rotateRefresh(refreshToken: string, clientId: string): Promise<TokenPair | { error: "invalid_grant" }> {
    const invalid = { error: "invalid_grant" as const };
    const rec = await store.take<RefreshRecord>(refreshKey(refreshToken));
    if (rec) {
      if (rec.clientId !== clientId) {
        await store.set(refreshKey(refreshToken), rec, { ttlMs: rec.expiresAt - clock() });
        return invalid;
      }
      const grant = await getGrant(rec.grantId);
      if (!grant) return invalid;
      await store.set(usedKey(refreshToken), { grantId: rec.grantId, usedAt: clock() } satisfies RefreshUsed, {
        ttlMs: REFRESH_TTL_MS,
      });
      await saveGrant(rec.grantId, { ...grant, expiresAt: clock() + REFRESH_TTL_MS });
      return await issuePair(rec.grantId, clientId);
    }
    const used = await store.get<RefreshUsed>(usedKey(refreshToken));
    if (!used) return invalid; // unknown, or the loser of a concurrent rotation
    if (clock() - used.usedAt <= REUSE_GRACE_MS) return invalid; // e.g. two tabs: keep the grant
    await revokeGrant(used.grantId); // reuse after the grace window: assume theft
    return invalid;
  }

  async function updateGoogleTokens(
    grantId: string,
    t: { accessToken: string; refreshToken: string; expiresIn: number },
  ): Promise<void> {
    const grant = await getGrant(grantId);
    if (!grant) return;
    await saveGrant(grantId, {
      ...grant,
      encGoogleAccess: await cipher.encrypt(t.accessToken),
      encGoogleRefresh: await cipher.encrypt(t.refreshToken),
      googleExpiresAt: clock() + t.expiresIn * 1000,
    });
  }

  async function listGrants(email?: string): Promise<Array<{ grantId: string; grant: Grant }>> {
    if (email) {
      const ids = (await store.list(["grants_by_email", email.toLowerCase()])).map((e) => e.key[2]);
      const out: Array<{ grantId: string; grant: Grant }> = [];
      for (const grantId of ids) {
        const grant = await getGrant(grantId);
        if (grant) out.push({ grantId, grant });
      }
      return out;
    }
    return (await store.list<Grant>(["grants"])).map((e) => ({ grantId: e.key[1], grant: e.value }));
  }

  return { createGrant, getGrant, issuePair, resolveAccess, rotateRefresh, revokeGrant, updateGoogleTokens, listGrants };
}
