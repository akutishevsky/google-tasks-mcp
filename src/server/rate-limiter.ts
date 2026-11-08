import { Context, Next } from "hono";
import type { AppDeps } from "../deps.ts";

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

/**
 * The client address for rate limiting. Without `hops` this is upstream's
 * behaviour (whole X-Forwarded-For value, which the client controls). With
 * TRUST_PROXY_HOPS=n, the n-th entry from the right: the address our n
 * trusted proxies saw (Cloud Run: 1).
 */
export function clientIp(headers: Headers, hops?: number): string {
  const xff = headers.get("x-forwarded-for");
  if (hops === undefined) {
    return xff || headers.get("x-real-ip") || "unknown";
  }
  const entries = (xff ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) return headers.get("x-real-ip") || "unknown";
  return entries[Math.max(0, entries.length - hops)];
}

export function rateLimit(deps: Pick<AppDeps, "store" | "clock" | "config">, config: RateLimitConfig) {
  const { store, clock } = deps;
  return async (c: Context, next: Next) => {
    const ip = clientIp(c.req.raw.headers, deps.config.trustProxyHops);
    const key = ["rate_limit", c.req.path, ip];

    const now = clock();

    const entry = await store.get<{ count: number; resetAt: number }>(key);

    if (entry && entry.resetAt > now) {
      if (entry.count >= config.maxRequests) {
        return c.json(
          {
            error: "rate_limit_exceeded",
            error_description: "Too many requests. Please try again later.",
          },
          429
        );
      }
      await store.set(key, { count: entry.count + 1, resetAt: entry.resetAt }, { ttlMs: config.windowMs });
    } else {
      await store.set(key, { count: 1, resetAt: now + config.windowMs }, { ttlMs: config.windowMs });
    }

    await next();
  };
}
