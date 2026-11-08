// Cloud KMS encrypts each token directly (well under the 64 KiB limit); no
// key material ever lives in this process.
import { Buffer } from "node:buffer";
import type { TokenCipher } from "./cipher.ts";
import { BackendUnavailableError } from "../store/store.ts";

/** The two KeyManagementServiceClient calls we use (the seam for tests). */
export interface KmsClientLike {
  encrypt(req: { name: string; plaintext: Uint8Array }): Promise<[{ ciphertext?: Uint8Array | string | null }, ...unknown[]]>;
  decrypt(req: { name: string; ciphertext: Uint8Array }): Promise<[{ plaintext?: Uint8Array | string | null }, ...unknown[]]>;
}

const UNAVAILABLE = new Set([4, 14]); // DEADLINE_EXCEEDED, UNAVAILABLE

async function guard<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (UNAVAILABLE.has((error as { code?: number }).code ?? -1)) throw new BackendUnavailableError("kms", error);
    throw error;
  }
}

export class KmsCipher implements TokenCipher {
  constructor(private readonly client: KmsClientLike, private readonly keyName: string) {}

  async encrypt(plaintext: string): Promise<string> {
    const [res] = await guard(() => this.client.encrypt({ name: this.keyName, plaintext: Buffer.from(plaintext, "utf-8") }));
    if (!res.ciphertext) throw new Error("KMS returned no ciphertext");
    return Buffer.from(res.ciphertext).toString("base64");
  }

  async decrypt(ciphertext: string): Promise<string> {
    const [res] = await guard(() => this.client.decrypt({ name: this.keyName, ciphertext: Buffer.from(ciphertext, "base64") }));
    if (res.plaintext === null || res.plaintext === undefined) throw new Error("KMS returned no plaintext");
    return Buffer.from(res.plaintext).toString("utf-8");
  }
}
