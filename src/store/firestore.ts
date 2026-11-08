// Firestore backend ("gcloud" option). key[0] is the collection; the rest is
// encoded into the document id. Each document is { v, expiresAt } with
// expiresAt a Timestamp, so a Firestore TTL policy on expiresAt can garbage
// collect; reads still check expiry against the injected clock.
import type { Firestore } from "@google-cloud/firestore";
import type { Clock, Envelope, Store, StoreKey } from "./store.ts";
import { BackendUnavailableError, isLive } from "./store.ts";

const SEP = "~";

/** Reversible, collision-free, prefix-ordered, and a valid Firestore document id. */
export function encodeDocId(parts: string[]): string {
  return parts
    .map((p) => encodeURIComponent(p).replace(/\./g, "%2E").replace(/~/g, "%7E").replace(/_/g, "%5F"))
    .join(SEP);
}

export function decodeDocId(id: string): string[] {
  return id.split(SEP).map((p) => decodeURIComponent(p));
}

type Doc = { v: unknown; expiresAt: Date | { toMillis(): number } | null };

// Firestore rejects undefined; JSON round-trip drops it (values are plain data).
function plain<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function toEnvelope(doc: Doc | undefined): Envelope<unknown> | null {
  if (!doc) return null;
  const e = doc.expiresAt;
  const expiresAt = e === null || e === undefined ? null : e instanceof Date ? e.getTime() : e.toMillis();
  return { v: doc.v, expiresAt };
}

const UNAVAILABLE = new Set([4, 14]); // DEADLINE_EXCEEDED, UNAVAILABLE

async function guard<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (UNAVAILABLE.has((error as { code?: number }).code ?? -1)) throw new BackendUnavailableError("firestore", error);
    throw error;
  }
}

export class FirestoreStore implements Store {
  constructor(private readonly db: Firestore, private readonly clock: Clock) {}

  private ref(key: StoreKey) {
    if (key.length < 2) throw new Error("FirestoreStore keys need a collection and at least one id part");
    return this.db.collection(key[0]).doc(encodeDocId(key.slice(1)));
  }

  async get<T>(key: StoreKey): Promise<T | null> {
    const snap = await guard(() => this.ref(key).get());
    const env = toEnvelope(snap.data() as Doc | undefined);
    return isLive(env, this.clock) ? (env.v as T) : null;
  }

  async set<T>(key: StoreKey, value: T, opts?: { ttlMs?: number }): Promise<void> {
    const expiresAt = opts?.ttlMs === undefined ? null : new Date(this.clock() + opts.ttlMs);
    await guard(() => this.ref(key).set({ v: plain(value), expiresAt }));
  }

  async delete(key: StoreKey): Promise<void> {
    await guard(() => this.ref(key).delete());
  }

  async take<T>(key: StoreKey): Promise<T | null> {
    const ref = this.ref(key);
    return await guard(() =>
      this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        tx.delete(ref);
        const env = toEnvelope(snap.data() as Doc);
        return isLive(env, this.clock) ? (env.v as T) : null;
      }),
    );
  }

  async list<T>(prefix: StoreKey): Promise<Array<{ key: StoreKey; value: T }>> {
    const { FieldPath } = await import("@google-cloud/firestore");
    const col = this.db.collection(prefix[0]);
    const rest = prefix.slice(1);
    const query =
      rest.length === 0
        ? col
        : col
            .where(FieldPath.documentId(), ">=", encodeDocId(rest) + SEP)
            .where(FieldPath.documentId(), "<", encodeDocId(rest) + SEP + "");
    const snap = await guard(() => query.get());
    const out: Array<{ key: StoreKey; value: T }> = [];
    for (const d of snap.docs) {
      const env = toEnvelope(d.data() as Doc);
      if (isLive(env, this.clock)) out.push({ key: [prefix[0], ...decodeDocId(d.id)], value: env.v as T });
    }
    return out;
  }

  async close(): Promise<void> {
    await this.db.terminate();
  }
}
