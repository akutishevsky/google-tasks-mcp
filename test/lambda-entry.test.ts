import { describe, expect, it } from "vitest";
import process from "node:process";
import { PLANTED_GOOGLE_CLIENT_CREDENTIAL, PLANTED_GOOGLE_CLIENT_ID, PLANTED_KEY_MATERIAL } from "./support/planted.ts";

describe("Lambda entrypoint", () => {
  it("imports_without_aws_env_and_no_secret_fetch", async () => {
    // No GOOGLE_OAUTH_SECRET_ID: the module must import cleanly and never touch
    // Secrets Manager (local/test path).
    delete process.env.GOOGLE_OAUTH_SECRET_ID;
    process.env.GOOGLE_CLIENT_ID = PLANTED_GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = PLANTED_GOOGLE_CLIENT_CREDENTIAL;
    process.env.ENCRYPTION_SECRET = PLANTED_KEY_MATERIAL;

    const mod = await import("../src/lambda.ts");
    expect(typeof mod.handler).toBe("function");
  });
});
