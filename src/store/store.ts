export type Clock = () => number;

export type StoreKey = string[];

export interface Store {
  /** null when absent or expired */
  get<T>(key: StoreKey): Promise<T | null>;
  set<T>(key: StoreKey, value: T, opts?: { ttlMs?: number }): Promise<void>;
  delete(key: StoreKey): Promise<void>;
  /** atomic get + delete; exactly one concurrent caller receives the value */
  take<T>(key: StoreKey): Promise<T | null>;
  list<T>(prefix: StoreKey): Promise<Array<{ key: StoreKey; value: T }>>;
  close(): Promise<void>;
}

/**
 * Every backend stores this envelope. Reads compare expiresAt with the
 * injected clock, so expiry is identical across backends; backend TTLs are
 * garbage collection only (Firestore TTL deletion can lag by a day).
 */
export interface Envelope<T> {
  v: T;
  expiresAt: number | null;
}

export function wrap<T>(value: T, clock: Clock, ttlMs?: number): Envelope<T> {
  return { v: value, expiresAt: ttlMs === undefined ? null : clock() + ttlMs };
}

export function isLive(env: Envelope<unknown> | null | undefined, clock: Clock): env is Envelope<unknown> {
  return !!env && (env.expiresAt === null || env.expiresAt > clock());
}

/** Thrown by remote backends when the service is unreachable (mapped to 503). */
export class BackendUnavailableError extends Error {
  constructor(component: string, cause?: unknown) {
    super(`${component} unavailable`);
    this.name = "BackendUnavailableError";
    this.cause = cause;
  }
}
