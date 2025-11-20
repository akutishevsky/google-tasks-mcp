import { Context } from "hono";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSETransport } from "../transport/mcp-transport.js";
import { registerAllTools } from "../tools/index.js";
import { createLogger } from "../utils/logger.js";
import crypto from "node:crypto";

const logger = createLogger({ component: "mcp-endpoints" });

const sessions = new Map<string, { server: Server; transport: SSETransport }>();

export async function handleMcpGet(c: Context) {
  const mcpToken = c.get("mcpToken");
  const sessionId = c.req.header("Mcp-Session-Id") || crypto.randomUUID();

  logger.info("MCP GET request", { sessionId });

  let session = sessions.get(sessionId);

  if (!session) {
    const server = new Server(
      {
        name: "google-tasks-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    const transport = new SSETransport(server, sessionId);

    registerAllTools(server, mcpToken);

    session = { server, transport };
    sessions.set(sessionId, session);

    logger.info("Created new MCP session", { sessionId });
  }

  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");
  c.header("Mcp-Session-Id", sessionId);

  const stream = new ReadableStream({
    start(controller) {
      session!.transport.setMessageHandler((message: string) => {
        controller.enqueue(`data: ${message}\n\n`);
      });

      const keepAlive = setInterval(() => {
        controller.enqueue(": keepalive\n\n");
      }, 30000);

      return () => {
        clearInterval(keepAlive);
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Mcp-Session-Id": sessionId,
    },
  });
}

export async function handleMcpPost(c: Context) {
  const sessionId = c.req.header("Mcp-Session-Id");

  if (!sessionId) {
    logger.warn("MCP POST request without session ID");
    return c.json({ error: "Missing Mcp-Session-Id header" }, 400);
  }

  const session = sessions.get(sessionId);

  if (!session) {
    logger.warn("MCP POST request with invalid session ID", { sessionId });
    return c.json({ error: "Invalid session" }, 404);
  }

  try {
    const message = await c.req.text();
    logger.debug("Received MCP message", { sessionId });

    const jsonMessage = JSON.parse(message);

    const response = await session.server.handleRequest(jsonMessage);

    return c.json(response);
  } catch (error) {
    logger.error("Error handling MCP request", {
      sessionId,
      error: String(error),
    });
    return c.json(
      {
        error: "internal_server_error",
        error_description: "Failed to process MCP request",
      },
      500
    );
  }
}
