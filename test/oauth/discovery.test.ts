// Boundary handler: discovery documents and 401 challenges (MCP auth spec, rank 4).
import { describe, expect, it } from "vitest";
import { startTestServer } from "../support/test-server.ts";
import { BASE, req } from "../support/oauth-driver.ts";
import { mcpRaw } from "../support/mcp-client.ts";

const PRM_PATHS = ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"];

describe("discovery", () => {
  it("discovery_documents", async () => {
    const s = await startTestServer();
    const as = await (await req(s.app, "/.well-known/oauth-authorization-server")).json();
    expect(as.issuer).toBe(BASE);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.registration_endpoint).toBe(`${BASE}/register`);
    expect(as.authorization_endpoint).toBe(`${BASE}/authorize`);
    expect(as.token_endpoint).toBe(`${BASE}/token`);
    expect(as.grant_types_supported).toContain("refresh_token");
    expect(as.grant_types_supported).toContain("authorization_code");
    expect(as.response_types_supported).toEqual(["code"]);
    expect(as.token_endpoint_auth_methods_supported).toEqual(["none", "client_secret_post"]);
    expect(as.mcp_endpoint).toBe(`${BASE}/mcp`);

    for (const p of PRM_PATHS) {
      const r = await req(s.app, p);
      expect(r.status, p).toBe(200);
      expect(await r.json(), p).toEqual({
        resource: `${BASE}/mcp`,
        authorization_servers: [BASE],
        bearer_methods_supported: ["header"],
      });
    }
  });

  it("issuer_url_pins_issuer", async () => {
    const s = await startTestServer({ env: { ISSUER_URL: "https://tasks.example.com" } });
    const as = await (await req(s.app, "/.well-known/oauth-authorization-server")).json();
    expect(as.issuer).toBe("https://tasks.example.com");
    expect(as.token_endpoint).toBe("https://tasks.example.com/token");
    const prm = await (await req(s.app, PRM_PATHS[1])).json();
    expect(prm.resource).toBe("https://tasks.example.com/mcp");
    const r = await mcpRaw(s.app, null, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(r.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://tasks.example.com/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("mcp_without_bearer", async () => {
    const s = await startTestServer();
    for (const token of [null, "not-a-real-token"]) {
      const r = await mcpRaw(s.app, token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(r.status, String(token)).toBe(401);
      expect(r.headers.get("www-authenticate"), String(token)).toBe(
        `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`,
      );
    }
  });
});
