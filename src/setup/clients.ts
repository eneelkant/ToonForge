import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ClientName = "cursor" | "gemini" | "claude" | "chatgpt";

export interface McpStdioServer {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function toonforgeStdioServer(command = "toonforge"): McpStdioServer {
  return {
    command,
    args: ["mcp"],
    env: {
      YOUTUBE_DRY_RUN: "true",
      TOONFORGE_LOG_LEVEL: "error",
    },
  };
}

export function cursorConfig(server: McpStdioServer = toonforgeStdioServer()): string {
  return JSON.stringify({ mcpServers: { toonforge: server } }, null, 2);
}

export function geminiConfig(server: McpStdioServer = toonforgeStdioServer()): string {
  return JSON.stringify({ mcpServers: { toonforge: server } }, null, 2);
}

export function claudeCodeConfig(server: McpStdioServer = toonforgeStdioServer()): string {
  return JSON.stringify({ mcpServers: { toonforge: server } }, null, 2);
}

export function claudeDesktopConfig(server: McpStdioServer = toonforgeStdioServer()): string {
  return JSON.stringify({ mcpServers: { toonforge: server } }, null, 2);
}

/** ChatGPT web and desktop apps do not launch local stdio servers. */
export function chatgptRemoteExample(publicHttpsUrl: string): string {
  return JSON.stringify(
    {
      transport: "streamable-http",
      mcpServerUrl: publicHttpsUrl,
      authentication: "bearer token supplied to the connector, matching TOONFORGE_MCP_TOKEN",
      note: "ChatGPT Developer Mode registers a remote HTTPS MCP URL. This file is an example, not an app-store manifest.",
    },
    null,
    2,
  );
}

export function mergeMcpServers(existingRaw: string | null, server: McpStdioServer): string {
  let existing: { mcpServers?: Record<string, unknown> } = {};
  if (existingRaw?.trim()) {
    existing = JSON.parse(existingRaw) as { mcpServers?: Record<string, unknown> };
  }
  const servers = { ...(existing.mcpServers ?? {}) };
  servers.toonforge = server;
  return JSON.stringify({ ...existing, mcpServers: servers }, null, 2);
}

export function writeIfAbsentOrMerge(path: string, server: McpStdioServer): { path: string; action: "created" | "updated" } {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, mergeMcpServers(null, server), { mode: 0o600 });
    return { path, action: "created" };
  }
  const current = readFileSync(path, "utf8");
  writeFileSync(path, mergeMcpServers(current, server), { mode: 0o600 });
  return { path, action: "updated" };
}

export function clientTargetPath(client: ClientName, home: string, platform: NodeJS.Platform): string | null {
  if (client === "cursor") return join(home, ".cursor", "mcp.json");
  if (client === "gemini") return join(home, ".gemini", "settings.json");
  if (client === "claude") {
    if (platform === "darwin") return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    if (platform === "win32") return join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json");
    return join(home, ".config", "Claude", "claude_desktop_config.json");
  }
  return null;
}
