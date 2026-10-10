import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadRuntimeConfig } from "../core/config.js";
import { createToonForgeMcpServer } from "./server.js";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
const hits = new Map<string, number[]>();

function authorized(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const presented = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(token);
  if (presented.length !== expected.length || presented.length === 0) return false;
  return timingSafeEqual(presented, expected);
}

function rateLimited(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((stamp) => now - stamp < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

export interface McpHttpOptions {
  host?: string;
  port?: number;
  token: string;
  maxBodyBytes?: number;
}

export async function startMcpHttp(options?: Partial<McpHttpOptions>): Promise<Server> {
  const config = loadRuntimeConfig();
  const token = options?.token ?? process.env.TOONFORGE_MCP_TOKEN ?? "";
  if (!token) {
    throw new Error("TOONFORGE_MCP_TOKEN is required for the HTTP MCP server");
  }
  const host = options?.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("HTTP MCP binds to loopback only. Put a TLS reverse proxy in front of it for ChatGPT.");
  }
  const port = options?.port ?? Number(process.env.TOONFORGE_MCP_PORT || 8787);
  const maxBodyBytes = options?.maxBodyBytes ?? config.mcpMaxBytes;

  const server = createServer(async (req, res) => {
    try {
      await handle(req, res, token, maxBodyBytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: message }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  console.error(`toonforge mcp http listening on http://${host}:${port}/mcp`);
  return server;
}

async function handle(req: IncomingMessage, res: ServerResponse, token: string, maxBodyBytes: number): Promise<void> {
  const ip = req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip, Date.now())) {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "rate limit" }));
    return;
  }
  if (!authorized(req.headers.authorization, token)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  const length = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(length) && length > maxBodyBytes) {
    res.writeHead(413, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "payload too large" }));
    return;
  }
  const mcp = createToonForgeMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    maxRequestBodySize: maxBodyBytes,
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
  res.on("close", () => {
    void transport.close();
    void mcp.close();
  });
}
