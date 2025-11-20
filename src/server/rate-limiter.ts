import { openKv } from "@deno/kv";
import { Context, Next } from "hono";

let kv: Awaited<ReturnType<typeof openKv>> | null = null;

export async function initRateLimiter() {
  kv = await openKv();
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export function rateLimit(config: RateLimitConfig) {
  return async (c: Context, next: Next) => {
    if (!kv) {
      await next();
      return;
    }

    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    const key = ["rate_limit", c.req.path, ip];

    const now = Date.now();
    const windowStart = now - config.windowMs;

    const entry = await kv.get<{ count: number; resetAt: number }>(key);

    if (entry.value) {
      if (entry.value.resetAt > now) {
        if (entry.value.count >= config.maxRequests) {
          return c.json(
            {
              error: "rate_limit_exceeded",
              error_description: "Too many requests. Please try again later.",
            },
            429
          );
        }

        await kv.set(
          key,
          {
            count: entry.value.count + 1,
            resetAt: entry.value.resetAt,
          },
          { expireIn: config.windowMs }
        );
      } else {
        await kv.set(
          key,
          {
            count: 1,
            resetAt: now + config.windowMs,
          },
          { expireIn: config.windowMs }
        );
      }
    } else {
      await kv.set(
        key,
        {
          count: 1,
          resetAt: now + config.windowMs,
        },
        { expireIn: config.windowMs }
      );
    }

    await next();
  };
}
