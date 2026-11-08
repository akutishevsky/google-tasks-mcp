// Minimal MCP client over app.fetch. Accepts SSE or JSON bodies, so tests and
// goldens are independent of the transport framing.
import type { FetchApp } from "./oauth-driver.ts";
import { req } from "./oauth-driver.ts";

export type JsonRpc = { jsonrpc: "2.0"; id?: number | string; result?: any; error?: any; method?: string };

export function parseMessages(contentType: string, text: string): JsonRpc[] {
  if (!text.trim()) return [];
  if (contentType.includes("text/event-stream")) {
    return text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => JSON.parse(l.slice(5).trim()) as JsonRpc);
  }
  const j = JSON.parse(text);
  return Array.isArray(j) ? j : [j];
}

export async function mcpRaw(app: FetchApp, accessToken: string | null, body: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...headers,
  };
  if (accessToken) h.Authorization = `Bearer ${accessToken}`;
  const res = await req(app, "/mcp", { method: "POST", headers: h, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, messages: parseMessages(res.headers.get("content-type") ?? "", text) };
}

let nextId = 1;
export async function mcp(app: FetchApp, accessToken: string | null, method: string, params?: unknown) {
  return await mcpRaw(app, accessToken, { jsonrpc: "2.0", id: nextId++, method, params: params ?? {} });
}

export async function callTool(app: FetchApp, accessToken: string, name: string, args: Record<string, unknown>) {
  const r = await mcp(app, accessToken, "tools/call", { name, arguments: args });
  return { ...r, result: r.messages[0]?.result, error: r.messages[0]?.error };
}
