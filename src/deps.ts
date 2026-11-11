import type { Config } from "./config.ts";
import type { TokenCipher } from "./crypto/cipher.ts";
import { StaticCipher } from "./crypto/static.ts";
import type { KmsClientLike } from "./crypto/kms.ts";
import type { AwsKmsClientLike } from "./crypto/awskms.ts";
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
  if (config.storage === "dynamodb") {
    const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
    const { DynamoDbStore } = await import("./store/dynamodb.ts");
    return new DynamoDbStore(new DynamoDBClient({ region: config.awsRegion }), config.dynamoDbTable!, clock);
  }
  return await DenoKvStore.open({ path: config.kvPath, clock });
}

async function buildCipher(config: Config): Promise<TokenCipher> {
  if (config.cipher === "gcpkms") {
    const { KeyManagementServiceClient } = await import("@google-cloud/kms");
    const { KmsCipher } = await import("./crypto/kms.ts");
    return new KmsCipher(new KeyManagementServiceClient() as unknown as KmsClientLike, config.kmsKeyName!);
  }
  if (config.cipher === "awskms") {
    const { KMSClient, EncryptCommand, DecryptCommand } = await import("@aws-sdk/client-kms");
    const { AwsKmsCipher } = await import("./crypto/awskms.ts");
    const client = new KMSClient({ region: config.awsRegion });
    const adapter: AwsKmsClientLike = {
      encrypt: (req) => client.send(new EncryptCommand(req)),
      decrypt: (req) => client.send(new DecryptCommand(req)),
    };
    return new AwsKmsCipher(adapter, config.awsKmsKeyId!);
  }
  return new StaticCipher(config.encryptionSecret!);
}

export async function buildDeps(config: Config): Promise<AppDeps> {
  const clock: Clock = Date.now;
  const cipher = await buildCipher(config);
  const store = await buildStore(config, clock);
  return { store, clock, config, cipher, fetch: (input, init) => fetch(input, init) };
}
