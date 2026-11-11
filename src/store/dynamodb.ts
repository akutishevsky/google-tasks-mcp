// DynamoDB backend ("dynamodb" option). key[0] is the partition key (pk); the
// rest is encoded into the sort key (sk). Each item is
// { pk, sk, v, expiresAt, ttl } where expiresAt is ms|null (checked against the
// injected clock on read) and ttl is an epoch-seconds number set only when a
// TTL is given, so a DynamoDB TTL policy on `ttl` can garbage collect.
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteItemCommand, GetItemCommand, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import type { Clock, Envelope, Store, StoreKey } from "./store.ts";
import { BackendUnavailableError, isLive } from "./store.ts";

const SEP = "~";

/** Reversible, collision-free, and prefix-ordered encoding of one key part. */
function encodePart(p: string): string {
  return encodeURIComponent(p).replace(/\./g, "%2E").replace(/~/g, "%7E").replace(/_/g, "%5F");
}

/** key.slice(1) -> sort key string. Reversible, collision-free, prefix-ordered. */
export function encodeSortKey(parts: string[]): string {
  return parts.map(encodePart).join(SEP);
}

export function decodeSortKey(sk: string): string[] {
  return sk.split(SEP).map((p) => decodeURIComponent(p));
}

type Item = { pk: string; sk: string; v: unknown; expiresAt: number | null; ttl?: number };

function toEnvelope(item: Item | undefined): Envelope<unknown> | null {
  if (!item) return null;
  return { v: item.v, expiresAt: item.expiresAt ?? null };
}

async function guard<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    const name = (error as { name?: string }).name;
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const unavailable =
      name === "ProvisionedThroughputExceededException" ||
      name === "ThrottlingException" ||
      name === "RequestLimitExceeded" ||
      name === "InternalServerError" ||
      status === 500 ||
      status === 503;
    if (unavailable) throw new BackendUnavailableError("dynamodb", error);
    throw error;
  }
}

export class DynamoDbStore implements Store {
  constructor(private readonly client: DynamoDBClient, private readonly table: string, private readonly clock: Clock) {}

  private keyParts(key: StoreKey): { pk: string; sk: string } {
    if (key.length < 2) throw new Error("DynamoDbStore keys need a partition and at least one id part");
    return { pk: key[0], sk: encodeSortKey(key.slice(1)) };
  }

  private marshalKey(key: StoreKey) {
    return marshall(this.keyParts(key));
  }

  async get<T>(key: StoreKey): Promise<T | null> {
    const res = await guard(() =>
      this.client.send(new GetItemCommand({ TableName: this.table, Key: this.marshalKey(key) })),
    );
    const item = res.Item ? (unmarshall(res.Item) as Item) : undefined;
    const env = toEnvelope(item);
    return isLive(env, this.clock) ? (env.v as T) : null;
  }

  async set<T>(key: StoreKey, value: T, opts?: { ttlMs?: number }): Promise<void> {
    const { pk, sk } = this.keyParts(key);
    const expiresAt = opts?.ttlMs === undefined ? null : this.clock() + opts.ttlMs;
    const item: Item = { pk, sk, v: value, expiresAt };
    if (expiresAt !== null) item.ttl = Math.ceil(expiresAt / 1000);
    await guard(() =>
      this.client.send(new PutItemCommand({ TableName: this.table, Item: marshall(item, { removeUndefinedValues: true }) })),
    );
  }

  async delete(key: StoreKey): Promise<void> {
    await guard(() => this.client.send(new DeleteItemCommand({ TableName: this.table, Key: this.marshalKey(key) })));
  }

  async take<T>(key: StoreKey): Promise<T | null> {
    const res = await guard(() =>
      this.client
        .send(
          new DeleteItemCommand({
            TableName: this.table,
            Key: this.marshalKey(key),
            ConditionExpression: "attribute_exists(pk)",
            ReturnValues: "ALL_OLD",
          }),
        )
        .catch((error: unknown) => {
          // Lost the race: another caller deleted first. Not a winner.
          if ((error as { name?: string }).name === "ConditionalCheckFailedException") return undefined;
          throw error;
        }),
    );
    if (!res || !res.Attributes) return null;
    const env = toEnvelope(unmarshall(res.Attributes) as Item);
    return isLive(env, this.clock) ? (env.v as T) : null;
  }

  async list<T>(prefix: StoreKey): Promise<Array<{ key: StoreKey; value: T }>> {
    const pk = prefix[0];
    const rest = prefix.slice(1);
    const out: Array<{ key: StoreKey; value: T }> = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await guard(() =>
        this.client.send(
          new QueryCommand({
            TableName: this.table,
            KeyConditionExpression:
              rest.length === 0 ? "pk = :pk" : "pk = :pk AND begins_with(sk, :skp)",
            ExpressionAttributeValues: marshall(
              rest.length === 0 ? { ":pk": pk } : { ":pk": pk, ":skp": encodeSortKey(rest) + SEP },
            ),
            ExclusiveStartKey: lastKey as Record<string, import("@aws-sdk/client-dynamodb").AttributeValue> | undefined,
          }),
        ),
      );
      for (const raw of res.Items ?? []) {
        const item = unmarshall(raw) as Item;
        const env = toEnvelope(item);
        if (isLive(env, this.clock)) out.push({ key: [pk, ...decodeSortKey(item.sk)], value: env.v as T });
      }
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    return out;
  }

  // No persistent connection to tear down; the SDK client is stateless here.
  close(): Promise<void> {
    this.client.destroy();
    return Promise.resolve();
  }
}
