import { Context } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { HonoSSETransport, sessionManager } from "../transport/mcp-transport.js";
import { registerAllTools } from "../tools/index.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger({ component: "mcp-endpoints" });

export async function handleMcpGet(c: Context) {
  const sessionId = c.req.header("Mcp-Session-Id") || crypto.randomUUID();
  const mcpAccessToken = c.get("mcpToken") as string;

  const existingSession = sessionManager.getSession(sessionId);
  if (existingSession) {
    logger.info("Closing existing MCP session to establish new connection");
    await existingSession.transport.close();
    sessionManager.deleteSession(sessionId);
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const writeSSE = async (data: string, event?: string) => {
    try {
      if (event) {
        await writer.write(encoder.encode(`event: ${event}\n`));
      }
      await writer.write(encoder.encode(`data: ${data}\n\n`));
    } catch (error) {
      // Silently handle write errors
    }
  };

  const transport = new HonoSSETransport();
  transport.attachStream({
    writeSSE: async (data: { data: string; event?: string; id?: string }) => {
      await writeSSE(data.data, data.event);
    },
    close: () => {
      writer.close();
    },
  });

  (async () => {
    try {
      const sessionServer = new McpServer(
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

      registerAllTools(sessionServer, mcpAccessToken);

      try {
        await sessionServer.connect(transport);

        sessionManager.createSession(sessionId, transport);
        logger.info("MCP session established via GET");

        c.req.raw.signal.addEventListener("abort", () => {
          logger.info("MCP connection closed by client");
          sessionManager.deleteSession(sessionId);
        });

        const heartbeat = setInterval(async () => {
          try {
            await writeSSE("", "ping");
          } catch (error) {
            clearInterval(heartbeat);
          }
        }, 15000);

        c.req.raw.signal.addEventListener("abort", () => {
          clearInterval(heartbeat);
          sessionManager.deleteSession(sessionId);
        });

      } catch (error) {
        logger.error("Failed to connect MCP server to transport");
        sessionManager.deleteSession(sessionId);
        writer.close();
      }
    } catch (error) {
      logger.error("Failed to initialize MCP session");
      writer.close();
    }
  })();

  const headers = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "Mcp-Session-Id": sessionId,
  };

  return new Response(readable, { headers });
}

export async function handleMcpPost(c: Context) {
  let sessionId = c.req.header("Mcp-Session-Id");
  const mcpToken = c.get("mcpToken") as string;

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    const message = await c.req.json() as JSONRPCMessage;

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const writeSSE = async (data: string, event?: string) => {
      try {
        if (event) {
          await writer.write(encoder.encode(`event: ${event}\n`));
        }
        await writer.write(encoder.encode(`data: ${data}\n\n`));
      } catch (error) {
        // Silently handle write errors
      }
    };

    const transport = new HonoSSETransport();
    transport.attachStream({
      writeSSE: async (data: { data: string; event?: string; id?: string }) => {
        await writeSSE(data.data, data.event);
      },
      close: () => {
        writer.close();
      },
    });

    (async () => {
      try {
        const sessionServer = new McpServer(
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

        registerAllTools(sessionServer, mcpToken);

        await sessionServer.connect(transport);

        sessionManager.createSession(sessionId!, transport);
        logger.info("MCP session established via POST");

        await transport.handleIncomingMessage(message);

        c.req.raw.signal.addEventListener("abort", () => {
          logger.info("MCP connection closed by client");
          sessionManager.deleteSession(sessionId!);
        });

        const heartbeat = setInterval(async () => {
          try {
            await writeSSE("", "ping");
          } catch (error) {
            clearInterval(heartbeat);
          }
        }, 15000);

        c.req.raw.signal.addEventListener("abort", () => {
          clearInterval(heartbeat);
          sessionManager.deleteSession(sessionId!);
        });

      } catch (error) {
        logger.error("Failed to initialize MCP session via POST");
        sessionManager.deleteSession(sessionId!);
        writer.close();
      }
    })();

    const headers = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Mcp-Session-Id": sessionId,
    };

    return new Response(readable, { headers });
  }

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    logger.warn("Message received for invalid or expired session");
    return c.json({
      error: "invalid_session",
      error_description: "Session not found or expired"
    }, 404);
  }

  try {
    const message = await c.req.json() as JSONRPCMessage;

    await session.transport.handleIncomingMessage(message);

    return c.body(null, 202);
  } catch (error) {
    logger.error("Failed to process incoming MCP message");
    return c.json({
      error: "internal_error",
      error_description: "Failed to process message"
    }, 500);
  }
}
