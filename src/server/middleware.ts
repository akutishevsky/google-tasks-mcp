import { Context, Next } from "hono";
import { tokenStore } from "../auth/token-store.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger({ component: "middleware" });

export async function authenticateBearer(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn("Authentication failed: missing or invalid Authorization header");
    return c.json(
      {
        error: "unauthorized",
        error_description: "Missing or invalid Authorization header",
      },
      401
    );
  }

  const token = authHeader.substring(7);

  const isValid = await tokenStore.isValid(token);
  if (!isValid) {
    logger.warn("Authentication failed: invalid or expired token");
    return c.json(
      {
        error: "unauthorized",
        error_description: "Invalid or expired access token",
      },
      401
    );
  }

  c.set("mcpToken", token);

  await next();
}
