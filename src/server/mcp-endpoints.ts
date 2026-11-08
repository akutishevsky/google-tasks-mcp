import { Context } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerAllTools } from "../tools/index.ts";
import type { AppDeps } from "../deps.ts";
import type { GoogleTokenProvider } from "../google/client.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger({ component: "mcp-endpoints" });

/**
 * POST /mcp: stateless Streamable HTTP. Each request gets its own server and
 * transport, so any instance can serve any request (no sessions, no SSE).
 */
export const handleMcpPost = (_deps: AppDeps, google: GoogleTokenProvider) => async (c: Context) => {
  const grantId = c.get("grantId") as string;

  const server = new McpServer(
    {
      name: "google-tasks-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );
  registerAllTools(server, google.clientFor(grantId));

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  // The transport answers bad requests (e.g. an unsupported protocol version)
  // with a 400 and reports why only here.
  transport.onerror = (error) => logger.warn("MCP request rejected", { reason: String(error) });

  try {
    await server.connect(transport);
    return await transport.handleRequest(c.req.raw);
  } catch (error) {
    logger.error("Failed to handle MCP request", { error: String(error) });
    throw error;
  } finally {
    // JSON responses are complete once handleRequest resolves.
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
};

/** GET/DELETE /mcp: no server-initiated streams or sessions in stateless mode. */
export function handleMcpMethodNotAllowed(c: Context) {
  return c.json(
    {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    },
    405,
    { Allow: "POST" },
  );
}
