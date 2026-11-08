import { describe, expect, it } from "vitest";
import { startTestServer } from "./support/test-server.ts";
import { req } from "./support/oauth-driver.ts";

describe("public pages", () => {
  it("public_pages_false", async () => {
    const s = await startTestServer({ env: { PUBLIC_PAGES: "false" } });
    const root = await req(s.app, "/");
    expect(root.status).toBe(200);
    expect(root.headers.get("content-type")).toMatch(/application\/json/);
    expect(await root.json()).toEqual({ message: "Google Tasks MCP Server" });
    const health = await req(s.app, "/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect((await req(s.app, "/privacy-policy")).status).toBe(404);
    for (const path of ["/", "/health", "/privacy-policy", "/favicon.ico"]) {
      const r = await req(s.app, path);
      expect(r.headers.get("content-security-policy") ?? "", path).not.toContain("googletagmanager");
    }
  });

  it("public_pages_default", async () => {
    const s = await startTestServer();
    const root = await req(s.app, "/");
    expect(root.headers.get("content-type")).toMatch(/text\/html/);
    expect(await root.text()).toContain("<html");
  });

  it("public_pages_auto_negotiates", async () => {
    const s = await startTestServer({ env: { PUBLIC_PAGES: "auto" } });
    const browser = await req(s.app, "/", { headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" } });
    expect(browser.headers.get("content-type")).toMatch(/text\/html/);
    expect(await browser.text()).toContain("<html");
    const api = await req(s.app, "/", { headers: { Accept: "application/json" } });
    expect(await api.json()).toEqual({ message: "Google Tasks MCP Server" });
    const bare = await req(s.app, "/");
    expect(bare.headers.get("content-type")).toMatch(/application\/json/);
    const privacyApi = await req(s.app, "/privacy-policy", { headers: { Accept: "application/json" } });
    expect(privacyApi.status).toBe(404);
    const privacyBrowser = await req(s.app, "/privacy-policy", { headers: { Accept: "text/html" } });
    expect(privacyBrowser.status).toBe(200);
    const health = await req(s.app, "/health", { headers: { Accept: "text/html" } });
    expect(await health.json()).toEqual({ status: "ok" });
  });

  it("analytics_false_strips_the_tag", async () => {
    const s = await startTestServer({ env: { ANALYTICS: "false" } });
    for (const path of ["/", "/privacy-policy"]) {
      const r = await req(s.app, path, { headers: { Accept: "text/html" } });
      const body = await r.text();
      expect(body, path).toContain("<html");
      expect(body, path).not.toMatch(/googletagmanager|gtag\(/);
      expect(r.headers.get("content-security-policy") ?? "", path).not.toMatch(/googletagmanager|google-analytics/);
    }
  });

  it("analytics_default_keeps_the_tag", async () => {
    const s = await startTestServer();
    expect(await (await req(s.app, "/privacy-policy")).text()).toContain("googletagmanager");
  });

  it("privacy_policy_url_redirects", async () => {
    const s = await startTestServer({ env: { PUBLIC_PAGES: "auto", PRIVACY_POLICY_URL: "https://example.com/privacy" } });
    for (const accept of ["text/html", "application/json"]) {
      const r = await req(s.app, "/privacy-policy", { headers: { Accept: accept }, redirect: "manual" });
      expect(r.status, accept).toBe(302);
      expect(r.headers.get("location"), accept).toBe("https://example.com/privacy");
    }
  });
});
