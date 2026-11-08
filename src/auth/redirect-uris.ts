// Which redirect URIs a client may register, and (optionally) which this
// deployment accepts at all. Without an allowlist, anyone can register any
// https URI, so a crafted /authorize link would send a colleague's code to an
// attacker's site; ALLOWED_REDIRECT_URIS closes that for shared deployments.

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parse(uri: unknown): URL | null {
  if (typeof uri !== "string") return null;
  try {
    const u = new URL(uri);
    // userinfo is a classic way to disguise the real host
    return u.username || u.password || u.hash ? null : u;
  } catch {
    return null;
  }
}

export function isLoopback(u: URL): boolean {
  return u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);
}

/** An absolute https URI, or http on a loopback address (RFC 8252 §7.3). */
export function isValidRedirectUri(uri: unknown): uri is string {
  const u = parse(uri);
  return !!u && (u.protocol === "https:" || isLoopback(u));
}

/**
 * With no allowlist every valid URI is allowed (upstream behaviour). Entries
 * are exact URIs, or "loopback" for any http loopback address and port.
 */
export function isAllowedRedirectUri(uri: string, allowlist?: string[]): boolean {
  if (!allowlist) return true;
  const u = parse(uri);
  if (!u) return false;
  return allowlist.some((entry) => (entry === "loopback" ? isLoopback(u) : entry === uri));
}
