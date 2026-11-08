import { Buffer } from "node:buffer";

export interface IdTokenClaims {
  email?: string;
  email_verified?: boolean;
  hd?: string;
}

/**
 * Reads the claims of the id_token returned by Google's token endpoint. The
 * token arrives directly from Google over TLS, so its claims are used without
 * signature verification (Google's guidance for this flow). Returns {} when
 * the token is absent or malformed.
 */
export function parseIdToken(jwt: string | undefined): IdTokenClaims {
  if (!jwt) return {};
  const parts = jwt.split(".");
  if (parts.length < 2) return {};
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    return {
      email: typeof claims.email === "string" ? claims.email.toLowerCase() : undefined,
      email_verified: claims.email_verified === true || claims.email_verified === "true",
      hd: typeof claims.hd === "string" ? claims.hd.toLowerCase() : undefined,
    };
  } catch {
    return {};
  }
}
