import crypto from "node:crypto";

/** PKCE S256 code challenge for a verifier (RFC 7636 §4.2). */
export function pkceS256(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/** 256-bit random bearer or refresh value. */
export function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Store keys use this hash, never the raw value. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
