// The only module that interprets environment variables. Every default matches
// upstream behaviour; each optional setting is opt-in.

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface Config {
  google: OAuthConfig;
  issuerUrl?: string;
  storage: "denokv" | "firestore";
  kvPath?: string;
  firestoreDatabase?: string;
  cipher: "static" | "gcpkms";
  encryptionSecret?: string;
  kmsKeyName?: string;
  allowedDomain?: string;
  allowedRedirectUris?: string[];
  trustProxyHops?: number;
  publicPages: boolean | "auto";
  analytics: boolean;
  privacyPolicyUrl?: string;
  port: number;
  allowedOrigins: string[];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function opt(env: Env, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

function oneOf<T extends string>(env: Env, name: string, allowed: readonly T[], fallback: T): T {
  const v = opt(env, name) ?? fallback;
  if (!(allowed as readonly string[]).includes(v)) {
    throw new ConfigError(`${name} must be one of ${allowed.join(", ")} (got "${v}")`);
  }
  return v as T;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
  const v = opt(env, name);
  if (v === undefined) return fallback;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new ConfigError(`${name} must be "true" or "false" (got "${v}")`);
}

// "auto": HTML for browsers (Accept: text/html), JSON for everything else.
function pages(env: Env): boolean | "auto" {
  const v = oneOf(env, "PUBLIC_PAGES", ["true", "false", "auto"] as const, "true");
  return v === "auto" ? "auto" : v === "true";
}

function httpsUrl(env: Env, name: string): string | undefined {
  const v = opt(env, name);
  if (v === undefined) return undefined;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new ConfigError(`${name} must be a URL (got "${v}")`);
  }
  if (u.protocol !== "https:") throw new ConfigError(`${name} must be an https URL`);
  return v;
}

function issuer(env: Env): string | undefined {
  const v = opt(env, "ISSUER_URL");
  if (v === undefined) return undefined;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new ConfigError(`ISSUER_URL is not a valid URL (got "${v}")`);
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) {
    throw new ConfigError("ISSUER_URL must use https (http is allowed only for localhost)");
  }
  return v.replace(/\/+$/, "");
}

function redirectAllowlist(env: Env): string[] | undefined {
  const v = opt(env, "ALLOWED_REDIRECT_URIS");
  if (v === undefined) return undefined;
  const entries = v.split(",").map((e) => e.trim()).filter(Boolean);
  for (const e of entries) {
    if (e === "loopback") continue;
    let u: URL;
    try {
      u = new URL(e);
    } catch {
      throw new ConfigError(`ALLOWED_REDIRECT_URIS entry is not a URL or "loopback" (got "${e}")`);
    }
    if (u.protocol !== "https:") throw new ConfigError(`ALLOWED_REDIRECT_URIS entries must be https or "loopback" (got "${e}")`);
  }
  return entries;
}

function proxyHops(env: Env): number | undefined {
  const v = opt(env, "TRUST_PROXY_HOPS");
  if (v === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(v)) throw new ConfigError(`TRUST_PROXY_HOPS must be a positive integer (got "${v}")`);
  return Number(v);
}

export function loadConfig(env: Env): Config {
  const storage = oneOf(env, "STORAGE", ["denokv", "firestore"] as const, "denokv");
  const cipher = oneOf(env, "CIPHER", ["static", "gcpkms"] as const, "static");

  const encryptionSecret = opt(env, "ENCRYPTION_SECRET");
  if (cipher === "static") {
    if (!encryptionSecret) throw new ConfigError("ENCRYPTION_SECRET is required when CIPHER=static");
    if (encryptionSecret.length < 32) throw new ConfigError("ENCRYPTION_SECRET must be at least 32 characters long");
  }
  const kmsKeyName = opt(env, "KMS_KEY_NAME");
  if (cipher === "gcpkms" && !kmsKeyName) throw new ConfigError("KMS_KEY_NAME is required when CIPHER=gcpkms");
  const firestoreDatabase = opt(env, "FIRESTORE_DATABASE");
  if (storage === "firestore" && !firestoreDatabase) {
    throw new ConfigError("FIRESTORE_DATABASE is required when STORAGE=firestore");
  }

  const port = Number(opt(env, "PORT") ?? "3000");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError("PORT must be an integer port number");

  return {
    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
      redirectUri: opt(env, "GOOGLE_REDIRECT_URI") ?? "http://localhost:3000/callback",
    },
    issuerUrl: issuer(env),
    storage,
    kvPath: opt(env, "KV_PATH"),
    firestoreDatabase,
    cipher,
    encryptionSecret: cipher === "static" ? encryptionSecret : undefined,
    kmsKeyName,
    allowedDomain: opt(env, "ALLOWED_DOMAIN")?.toLowerCase(),
    allowedRedirectUris: redirectAllowlist(env),
    trustProxyHops: proxyHops(env),
    publicPages: pages(env),
    analytics: bool(env, "ANALYTICS", true),
    privacyPolicyUrl: httpsUrl(env, "PRIVACY_POLICY_URL"),
    port,
    allowedOrigins: (opt(env, "ALLOWED_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean),
  };
}
