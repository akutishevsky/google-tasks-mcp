// AWS KMS encrypts each token directly. Google tokens are well under the KMS
// 4 KiB direct-encrypt limit, so no envelope encryption is needed; no key
// material ever lives in this process.
import { Buffer } from "node:buffer";
import type { TokenCipher } from "./cipher.ts";
import { BackendUnavailableError } from "../store/store.ts";

/** The two KMS calls the cipher makes (the seam for tests). */
export interface AwsKmsClientLike {
  encrypt(req: { KeyId: string; Plaintext: Uint8Array }): Promise<{ CiphertextBlob?: Uint8Array | null }>;
  decrypt(req: { CiphertextBlob: Uint8Array }): Promise<{ Plaintext?: Uint8Array | null }>;
}

async function guard<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    const name = (error as { name?: string }).name;
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const unavailable = name === "ThrottlingException" || name === "KMSInternalException" || status === 500 || status === 503;
    if (unavailable) throw new BackendUnavailableError("kms", error);
    throw error;
  }
}

export class AwsKmsCipher implements TokenCipher {
  constructor(private readonly client: AwsKmsClientLike, private readonly keyId: string) {}

  async encrypt(plaintext: string): Promise<string> {
    const res = await guard(() => this.client.encrypt({ KeyId: this.keyId, Plaintext: Buffer.from(plaintext, "utf-8") }));
    if (!res.CiphertextBlob) throw new Error("KMS returned no ciphertext");
    return Buffer.from(res.CiphertextBlob).toString("base64");
  }

  async decrypt(ciphertext: string): Promise<string> {
    const res = await guard(() => this.client.decrypt({ CiphertextBlob: Buffer.from(ciphertext, "base64") }));
    if (res.Plaintext === null || res.Plaintext === undefined) throw new Error("KMS returned no plaintext");
    return Buffer.from(res.Plaintext).toString("utf-8");
  }
}
