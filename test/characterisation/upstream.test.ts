// CHARACTERISATION, NOT CERTIFICATION. These goldens record what upstream did
// before the GCP-deployment changes. Each one is deleted when the scenario that
// certifies the same behaviour lands (see README.md here).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GoogleFake } from "../support/google-fake.ts";
import { login } from "../support/oauth-driver.ts";
import { mcp } from "../support/mcp-client.ts";
import { makeCharacterisationApp } from "./app.ts";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

function normalise(v: unknown): unknown {
  if (typeof v === "string") {
    const s = v.replace(UUID, "<uuid>");
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === "object") return { __json: normalise(parsed) };
    } catch {
      // not JSON
    }
    return s;
  }
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalise(x)]));
  return v;
}

const golden = (name: string) => `__goldens__/${name}.json`;
const pretty = (v: unknown) => JSON.stringify(normalise(v), null, 2) + "\n";

describe("characterisation: upstream behaviour", () => {
  const google = new GoogleFake();
  let app: Awaited<ReturnType<typeof makeCharacterisationApp>>["app"];
  let cleanup: () => Promise<void>;
  let token: string;

  beforeAll(async () => {
    ({ app, cleanup } = await makeCharacterisationApp(google));
    const l = await login(app, google);
    token = l.tokens.access_token;
  });
  afterAll(async () => {
    await cleanup();
  });

  it("tools_list", async () => {
    const r = await mcp(app, token, "tools/list");
    // Request ids are a client counter, not server behaviour.
    const messages = r.messages.map(({ id: _id, ...m }) => m);
    await expect(pretty(messages)).toMatchFileSnapshot(golden("tools_list"));
  });
});
