/** Encrypts Google tokens at rest. Implementations: StaticCipher, KmsCipher. */
export interface TokenCipher {
  encrypt(plaintext: string): Promise<string>;
  /** throws on tamper or wrong key */
  decrypt(ciphertext: string): Promise<string>;
}
