import { openKv } from "@deno/kv";
import type { Clock, Envelope, Store, StoreKey } from "./store.ts";
import { isLive, wrap } from "./store.ts";

type Kv = Awaited<ReturnType<typeof openKv>>;

/**
 * Deno KV backend. With no path this is native Deno KV on Deno Deploy, but an
 * IN-MEMORY store on Node; set KV_PATH for a sqlite file on Node.
 */
export class DenoKvStore implements Store {
  private constructor(private readonly kv: Kv, private readonly clock: Clock) {}

  static async open(opts: { path?: string; clock: Clock }): Promise<DenoKvStore> {
    return new DenoKvStore(await openKv(opts.path), opts.clock);
  }

  async get<T>(key: StoreKey): Promise<T | null> {
    const r = await this.kv.get<Envelope<T>>(key);
    return isLive(r.value, this.clock) ? (r.value as Envelope<T>).v : null;
  }

  async set<T>(key: StoreKey, value: T, opts?: { ttlMs?: number }): Promise<void> {
    await this.kv.set(key, wrap(value, this.clock, opts?.ttlMs), opts?.ttlMs ? { expireIn: opts.ttlMs } : undefined);
  }

  async delete(key: StoreKey): Promise<void> {
    await this.kv.delete(key);
  }

  async take<T>(key: StoreKey): Promise<T | null> {
    for (;;) {
      const r = await this.kv.get<Envelope<T>>(key);
      if (r.versionstamp === null) return null;
      const res = await this.kv.atomic().check(r).delete(key).commit();
      if (res.ok) return isLive(r.value, this.clock) ? (r.value as Envelope<T>).v : null;
    }
  }

  async list<T>(prefix: StoreKey): Promise<Array<{ key: StoreKey; value: T }>> {
    const out: Array<{ key: StoreKey; value: T }> = [];
    for await (const e of this.kv.list<Envelope<T>>({ prefix })) {
      if (isLive(e.value, this.clock)) out.push({ key: e.key as StoreKey, value: e.value.v });
    }
    return out;
  }

  async close(): Promise<void> {
    this.kv.close();
  }
}
