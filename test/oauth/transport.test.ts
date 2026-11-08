// Boundary handler: /mcp over the stateless Streamable HTTP transport (§5.5).
import { describe, expect, it } from "vitest";
import { startTestServer } from "../support/test-server.ts";
import { login, req } from "../support/oauth-driver.ts";
import { callTool, mcp, mcpRaw } from "../support/mcp-client.ts";
import { logs } from "../support/invariants.ts";

const TOOL_NAMES = [
  "list_task_lists", "get_task_list", "insert_task_list", "update_task_list", "patch_task_list", "delete_task_list",
  "list_tasks", "get_task", "insert_task", "update_task", "patch_task", "delete_task", "clear_completed_tasks", "move_task",
];

describe("transport", () => {
  it("stateless_across_instances", async () => {
    const a = await startTestServer();
    const b = await startTestServer({ store: a.deps.store, clock: a.clock, google: a.google });
    const { tokens } = await login(a.app, a.google);

    const init = await mcp(a.app, tokens.access_token, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t", version: "0" },
    });
    expect(init.status).toBe(200);
    expect(init.headers.get("content-type")).toMatch(/application\/json/);
    expect(init.headers.get("mcp-session-id")).toBeNull();
    expect(init.messages[0].result.serverInfo.name).toBe("google-tasks-mcp");

    a.google.queue("tasklists.list.ok");
    const call = await callTool(b.app, tokens.access_token, "list_task_lists", {});
    expect(call.status).toBe(200);
    expect(call.headers.get("content-type")).toMatch(/application\/json/);
    expect(call.result.isError).toBeFalsy();
  });

  it("notification_accepted", async () => {
    const s = await startTestServer();
    const { tokens } = await login(s.app, s.google);
    const r = await mcpRaw(s.app, tokens.access_token, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(r.status).toBe(202);
    expect(r.text).toBe("");
  });

  it("tools_list_has_14", async () => {
    const s = await startTestServer();
    const { tokens } = await login(s.app, s.google);
    const r = await mcp(s.app, tokens.access_token, "tools/list");
    expect(r.messages[0].result.tools.map((t: { name: string }) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("get_and_delete_are_answered_without_hanging", async () => {
    const s = await startTestServer();
    const { tokens } = await login(s.app, s.google);
    for (const method of ["GET", "DELETE"]) {
      const r = await req(s.app, "/mcp", {
        method,
        headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json, text/event-stream" },
      });
      expect(r.status, method).toBe(405);
      await r.text();
    }
  });

  it("transport_rejection_reason_is_logged", async () => {
    const s = await startTestServer();
    const { tokens } = await login(s.app, s.google);
    const r = await mcp(s.app, tokens.access_token, "tools/list");
    expect(r.status).toBe(200);
    const bad = await mcpRaw(s.app, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { "mcp-protocol-version": "1999-01-01" });
    expect(bad.status).toBe(400);
    expect(logs.some((l) => l.includes("MCP request rejected") && l.includes("Unsupported protocol version: 1999-01-01"))).toBe(true);
  });
});
