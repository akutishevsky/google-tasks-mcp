import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import type { TokenCipher } from "./cipher.ts";

// Upstream's format, unchanged so existing data still decrypts:
// base64(salt[64] || iv[16] || tag[16] || ciphertext), AES-256-GCM, key from
// PBKDF2-SHA256(secret, "google-tasks-mcp-salt", 100k). The per-record salt is
// random padding kept for format compatibility; the key salt is fixed.
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const ITERATIONS = 100000;
const KEY_SALT = "google-tasks-mcp-salt";

export class StaticCipher implements TokenCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (secret.length < 32) {
      throw new Error("ENCRYPTION_SECRET must be at least 32 characters long");
    }
    // Derived once per process instead of on every call.
    this.key = crypto.pbkdf2Sync(secret, Buffer.from(KEY_SALT), ITERATIONS, KEY_LENGTH, "sha256");
  }

  encrypt(plaintext: string): Promise<string> {
    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(SALT_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Promise.resolve(Buffer.concat([salt, iv, cipher.getAuthTag(), ct]).toString("base64"));
  }

  decrypt(ciphertext: string): Promise<string> {
    try {
      const buffer = Buffer.from(ciphertext, "base64");
      const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
      const tag = buffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
      const ct = buffer.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);
      return Promise.resolve(Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8"));
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
