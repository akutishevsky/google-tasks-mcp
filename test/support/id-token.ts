// Planted, unsigned id_tokens for the token-exchange fixture (the server reads
// claims without verifying the signature, per design §5.4).
import { Buffer } from "node:buffer";
import { loadFixture } from "./google-fake.ts";

export function plantedIdToken(claims: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "RS256", kid: "planted", typ: "JWT" })}.${enc({ iss: "https://accounts.google.com", sub: "1", ...claims })}.planted-signature`;
}

/** Overrides for GoogleFake.queue("token.exchange.ok") with a different id_token (or none). */
export function exchangeWithIdToken(claims: Record<string, unknown> | null) {
  const body = { ...(loadFixture("token.exchange.ok").response.body as Record<string, unknown>) };
  if (claims === null) delete body.id_token;
  else body.id_token = plantedIdToken(claims);
  return { body };
}
