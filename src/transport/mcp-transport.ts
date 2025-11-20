import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger({ component: "mcp-transport" });

export class SSETransport {
  private server: Server;
  private sessionId: string;
  private messageQueue: string[] = [];
  private onMessage?: (message: string) => void;

  constructor(server: Server, sessionId: string) {
    this.server = server;
    this.sessionId = sessionId;
  }

  async send(message: string): Promise<void> {
    if (this.onMessage) {
      this.onMessage(message);
    } else {
      this.messageQueue.push(message);
    }
  }

  setMessageHandler(handler: (message: string) => void) {
    this.onMessage = handler;
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift();
      if (msg) handler(msg);
    }
  }

  async receiveMessage(message: string): Promise<void> {
    logger.debug("Received message from client");
  }

  getSessionId(): string {
    return this.sessionId;
  }
}
