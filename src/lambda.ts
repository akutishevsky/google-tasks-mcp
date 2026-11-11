// AWS Lambda entrypoint (API Gateway): exports a `handle`-wrapped handler.
// At cold start, if GOOGLE_OAUTH_SECRET_ID is set, the single Secrets Manager
// secret holding the OAuth client is fetched and GOOGLE_CLIENT_ID/SECRET are
// injected into process.env BEFORE loadConfig runs, so config.ts stays the only
// module that reads env vars. With no AWS env the module imports cleanly.
import process from "node:process";
import { handle } from "@hono/aws-lambda";
import { loadConfig } from "./config.ts";
import { buildDeps } from "./deps.ts";
import { createApp } from "./server/app.ts";

async function loadOAuthSecret(): Promise<void> {
  const secretId = process.env.GOOGLE_OAUTH_SECRET_ID;
  if (!secretId) return;
  const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  const parsed = JSON.parse(res.SecretString ?? "{}") as { client_id?: string; client_secret?: string };
  if (parsed.client_id) process.env.GOOGLE_CLIENT_ID = parsed.client_id;
  if (parsed.client_secret) process.env.GOOGLE_CLIENT_SECRET = parsed.client_secret;
  client.destroy();
}

await loadOAuthSecret();
const app = createApp(await buildDeps(loadConfig(process.env)));

export const handler = handle(app);
