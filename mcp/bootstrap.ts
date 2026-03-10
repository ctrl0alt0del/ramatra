import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import express from "express";

const getTransportFromRequest = (
  req: express.Request,
  transports: Map<string, StreamableHTTPServerTransport>,
) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  return sessionId ? transports.get(sessionId) : undefined;
};

export function bootstrapExpressServerForMCPServer(
  port: number,
  mcpFactory: () => Promise<McpServer> | McpServer,
) {
  const app = express();
  app.use(express.json());

  const transports = new Map<string, StreamableHTTPServerTransport>();
  app.use((req, _res, next) => {
    console.log("[MCP]", req.method, req.path, req.headers["mcp-session-id"]);
    next();
  });
  app.post("/mcp", async (req, res) => {
    let transport = getTransportFromRequest(req, transports);
    if (!transport) {
      const mcpServer = await mcpFactory();

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          transports.set(newSessionId, transport!);
        },
      });

      transport.onclose = () => {
        if (transport?.sessionId) {
          transports.delete(transport.sessionId);
        }
      };

      await mcpServer.connect(transport);
    }

    transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req, res) => {
    const transport = getTransportFromRequest(req, transports);
    if (!transport) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "No active MCP session found for this request",
        },
        id: null,
      });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  });

  app.delete("/mcp", async (req, res) => {
    const transport = getTransportFromRequest(req, transports);
    if (!transport) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "No active MCP session found for this request",
        },
        id: null,
      });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(port, () => {
    console.log(`MCP server is listening on port ${port}`);
  });
}
