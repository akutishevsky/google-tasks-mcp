// Faithful fake of Cloud KMS encrypt/decrypt (a third-party network edge):
// real AES-GCM under a random key, bound to the key name, with tamper detection.
import crypto from "node:crypto";
import { Buffer } from "node:buffer";

export class KmsFake {
  private readonly key = crypto.randomBytes(32);
  private failures: number[] = [];
  encryptCalls = 0;
  decryptCalls = 0;

  /** The next call fails with this gRPC status code (14 = UNAVAILABLE). */
  failNext(code: number): void {
    this.failures.push(code);
  }

  private maybeFail() {
    const code = this.failures.shift();
    if (code !== undefined) throw Object.assign(new Error(`${code} fake KMS failure`), { code });
  }

  encrypt = async (req: { name?: string | null; plaintext?: Uint8Array | string | null }) => {
    this.encryptCalls++;
    this.maybeFail();
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    c.setAAD(Buffer.from(req.name ?? ""));
    const ct = Buffer.concat([c.update(Buffer.from(req.plaintext ?? "")), c.final()]);
    return [{ ciphertext: Buffer.concat([iv, c.getAuthTag(), ct]) }] as [{ ciphertext: Uint8Array }];
  };

  decrypt = async (req: { name?: string | null; ciphertext?: Uint8Array | string | null }) => {
    this.decryptCalls++;
    this.maybeFail();
    const buf = Buffer.from(req.ciphertext ?? "");
    const d = crypto.createDecipheriv("aes-256-gcm", this.key, buf.subarray(0, 12));
    d.setAAD(Buffer.from(req.name ?? ""));
    d.setAuthTag(buf.subarray(12, 28));
    const pt = Buffer.concat([d.update(buf.subarray(28)), d.final()]);
    return [{ plaintext: pt }] as [{ plaintext: Uint8Array }];
  };
}
