# ToonForge MCP Server

Client-agnostic Model Context Protocol server (stdio).

## Start

```bash
npm run mcp
# or
npx --yes tsx src/mcp/server.ts
# or after build:
node dist/mcp/server.js
```

## Cursor / Claude / ChatGPT / Gemini

Configure an MCP server with command:

```json
{
  "command": "node",
  "args": ["--import", "tsx", "/absolute/path/to/ToonForge/src/mcp/server.ts"],
  "cwd": "/absolute/path/to/ToonForge"
}
```

No client-specific business logic — all clients share the same tools/resources/prompts.

## Safety

- Default YouTube publish is dry-run
- `toonforge.pause` blocks irreversible tools
- Secrets are never returned by tools
- No arbitrary shell tool is exposed
