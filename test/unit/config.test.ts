import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/config.ts";
import { PLANTED_GOOGLE_CLIENT_CREDENTIAL, PLANTED_GOOGLE_CLIENT_ID, PLANTED_KEY_MATERIAL } from "../support/planted.ts";

const base = {
  GOOGLE_CLIENT_ID: PLANTED_GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: PLANTED_GOOGLE_CLIENT_CREDENTIAL,
  ENCRYPTION_SECRET: PLANTED_KEY_MATERIAL,
};

describe("loadConfig", () => {
  it("defaults_match_upstream", () => {
    const c = loadConfig(base);
    expect(c.storage).toBe("denokv");
    expect(c.cipher).toBe("static");
    expect(c.publicPages).toBe(true);
    expect(c.port).toBe(3000);
    expect(c.google.redirectUri).toBe("http://localhost:3000/callback");
    expect(c.issuerUrl).toBeUndefined();
    expect(c.allowedDomain).toBeUndefined();
    expect(c.trustProxyHops).toBeUndefined();
    expect(c.kvPath).toBeUndefined();
    expect(c.allowedOrigins).toEqual([]);
  });

  it("gcpkms_requires_key", () => {
    expect(() => loadConfig({ ...base, CIPHER: "gcpkms" })).toThrow(/KMS_KEY_NAME/);
    expect(loadConfig({ ...base, CIPHER: "gcpkms", KMS_KEY_NAME: "projects/p/locations/l/keyRings/r/cryptoKeys/k" }).cipher).toBe("gcpkms");
  });

  it("static_requires_secret", () => {
    expect(() => loadConfig({ ...base, ENCRYPTION_SECRET: undefined })).toThrow(/ENCRYPTION_SECRET/);
    expect(() => loadConfig({ ...base, ENCRYPTION_SECRET: "short" })).toThrow(/ENCRYPTION_SECRET/);
  });

  it("gcpkms_does_not_need_static_secret", () => {
    const c = loadConfig({ ...base, ENCRYPTION_SECRET: undefined, CIPHER: "gcpkms", KMS_KEY_NAME: "k" });
    expect(c.encryptionSecret).toBeUndefined();
  });

  it("firestore_requires_database", () => {
    expect(() => loadConfig({ ...base, STORAGE: "firestore" })).toThrow(/FIRESTORE_DATABASE/);
    expect(loadConfig({ ...base, STORAGE: "firestore", FIRESTORE_DATABASE: "db" }).firestoreDatabase).toBe("db");
  });

  it("issuer_url_must_be_https_or_localhost", () => {
    expect(() => loadConfig({ ...base, ISSUER_URL: "http://tasks.example.com" })).toThrow(/ISSUER_URL/);
    expect(() => loadConfig({ ...base, ISSUER_URL: "not a url" })).toThrow(/ISSUER_URL/);
    expect(loadConfig({ ...base, ISSUER_URL: "https://tasks.example.com/" }).issuerUrl).toBe("https://tasks.example.com");
    expect(loadConfig({ ...base, ISSUER_URL: "http://localhost:3000" }).issuerUrl).toBe("http://localhost:3000");
  });

  it("trust_proxy_hops_positive_int", () => {
    expect(loadConfig({ ...base, TRUST_PROXY_HOPS: "1" }).trustProxyHops).toBe(1);
    for (const bad of ["0", "-1", "1.5", "x"]) {
      expect(() => loadConfig({ ...base, TRUST_PROXY_HOPS: bad }), bad).toThrow(/TRUST_PROXY_HOPS/);
    }
  });

  it("public_pages_parses_false", () => {
    expect(loadConfig({ ...base, PUBLIC_PAGES: "false" }).publicPages).toBe(false);
    expect(loadConfig({ ...base, PUBLIC_PAGES: "true" }).publicPages).toBe(true);
    expect(() => loadConfig({ ...base, PUBLIC_PAGES: "nope" })).toThrow(/PUBLIC_PAGES/);
    expect(loadConfig({ ...base, PUBLIC_PAGES: "auto" }).publicPages).toBe("auto");
    expect(loadConfig(base).analytics).toBe(true);
    expect(loadConfig({ ...base, ANALYTICS: "false" }).analytics).toBe(false);
    expect(loadConfig({ ...base, PRIVACY_POLICY_URL: "https://example.com/p" }).privacyPolicyUrl).toBe("https://example.com/p");
    expect(() => loadConfig({ ...base, PRIVACY_POLICY_URL: "http://example.com/p" })).toThrow(/PRIVACY_POLICY_URL/);
  });

  it("unknown_storage_rejected", () => {
    expect(() => loadConfig({ ...base, STORAGE: "redis" })).toThrow(/STORAGE/);
    expect(() => loadConfig({ ...base, CIPHER: "rot13" })).toThrow(/CIPHER/);
  });

  it("passes_through_optional_values", () => {
    const c = loadConfig({
      ...base,
      KV_PATH: "/data/kv.sqlite",
      ALLOWED_DOMAIN: "example.com",
      PORT: "8080",
      ALLOWED_ORIGINS: "https://a.example, https://b.example",
      GOOGLE_REDIRECT_URI: "https://tasks.example.com/callback",
    });
    expect(c.kvPath).toBe("/data/kv.sqlite");
    expect(c.allowedDomain).toBe("example.com");
    expect(c.port).toBe(8080);
    expect(c.allowedOrigins).toEqual(["https://a.example", "https://b.example"]);
    expect(c.google.redirectUri).toBe("https://tasks.example.com/callback");
  });

  it("errors_are_config_errors", () => {
    expect(() => loadConfig({ ...base, STORAGE: "redis" })).toThrow(ConfigError);
  });
});
