// Faithful fake of AWS KMS encrypt/decrypt (a third-party network edge):
// real AES-256-GCM under a random key, bound to the key id (AAD), with tamper
// detection. AWS KMS ciphertext is opaque and self-identifies the key, so the
// blob carries the key id; decrypt uses it as AAD and rejects a wrong key.
import crypto from "node:crypto";
import { Buffer } from "node:buffer";

type AwsError = Error & { name: string; $metadata?: { httpStatusCode?: number } };

export class AwsKmsFake {
  private readonly key = crypto.randomBytes(32);
  private failures: string[] = [];
  encryptCalls = 0;
  decryptCalls = 0;

  /** The next call fails with this error name (e.g. "ThrottlingException"). */
  failNext(name: string): void {
    this.failures.push(name);
  }

  private maybeFail() {
    const name = this.failures.shift();
    if (name !== undefined) {
      const status = name === "KMSInternalException" ? 500 : undefined;
      const err = Object.assign(new Error(`fake KMS failure: ${name}`), { name, $metadata: { httpStatusCode: status } });
      throw err as AwsError;
    }
  }

  encrypt = (req: { KeyId: string; Plaintext: Uint8Array }) => {
    this.encryptCalls++;
    this.maybeFail();
    const keyId = Buffer.from(req.KeyId);
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    c.setAAD(keyId);
    const ct = Buffer.concat([c.update(Buffer.from(req.Plaintext)), c.final()]);
    // blob: keyIdLen[1] || keyId || iv[12] || tag[16] || ciphertext
    const blob = Buffer.concat([Buffer.from([keyId.length]), keyId, iv, c.getAuthTag(), ct]);
    return Promise.resolve({ CiphertextBlob: blob } as { CiphertextBlob: Uint8Array });
  };

  decrypt = (req: { CiphertextBlob: Uint8Array }) => {
    this.decryptCalls++;
    this.maybeFail();
    const buf = Buffer.from(req.CiphertextBlob);
    const keyIdLen = buf[0];
    const keyId = buf.subarray(1, 1 + keyIdLen);
    const rest = buf.subarray(1 + keyIdLen);
    const d = crypto.createDecipheriv("aes-256-gcm", this.key, rest.subarray(0, 12));
    d.setAAD(keyId);
    d.setAuthTag(rest.subarray(12, 28));
    const pt = Buffer.concat([d.update(rest.subarray(28)), d.final()]);
    return Promise.resolve({ Plaintext: pt } as { Plaintext: Uint8Array });
  };
}
