import type { Config } from "./config.ts";
import type { TokenCipher } from "./crypto/cipher.ts";
import { StaticCipher } from "./crypto/static.ts";
import type { KmsClientLike } from "./crypto/kms.ts";
import { DenoKvStore } from "./store/denokv.ts";
import type { Clock, Store } from "./store/store.ts";

/** Everything the app needs from the outside world, injected once at startup. */
export interface AppDeps {
  store: Store;
  clock: Clock;
  config: Config;
  cipher: TokenCipher;
  fetch: typeof fetch;
}

// The Google Cloud SDKs are optional dependencies, imported only when selected.
async function buildStore(config: Config, clock: Clock): Promise<Store> {
  if (config.storage === "firestore") {
    const { Firestore } = await import("@google-cloud/firestore");
    const { FirestoreStore } = await import("./store/firestore.ts");
    return new FirestoreStore(new Firestore({ databaseId: config.firestoreDatabase }), clock);
  }
  return await DenoKvStore.open({ path: config.kvPath, clock });
}

async function buildCipher(config: Config): Promise<TokenCipher> {
  if (config.cipher === "gcpkms") {
    const { KeyManagementServiceClient } = await import("@google-cloud/kms");
    const { KmsCipher } = await import("./crypto/kms.ts");
    return new KmsCipher(new KeyManagementServiceClient() as unknown as KmsClientLike, config.kmsKeyName!);
  }
  return new StaticCipher(config.encryptionSecret!);
}

export async function buildDeps(config: Config): Promise<AppDeps> {
  const clock: Clock = Date.now;
  const cipher = await buildCipher(config);
  const store = await buildStore(config, clock);
  return { store, clock, config, cipher, fetch: (input, init) => fetch(input, init) };
}
