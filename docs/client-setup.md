# MCP client setup

ToonForge has one tool implementation in `src/mcp/handlers.ts`. Client files only start that process. They do not contain a second copy of the workflow.

Build first so `dist/mcp/server.js` exists:

```bash
npm ci
npm run build
node dist/cli/index.js doctor
```

Logs go to stderr. Stdio MCP clients read JSON-RPC from stdout. Set `TOONFORGE_LOG_LEVEL=error` in the client env so routine logs stay quiet.

## Clients

| Client | Guide | Transport that works |
|--------|-------|----------------------|
| Cursor | [clients/cursor.md](clients/cursor.md) | stdio |
| Gemini CLI | [clients/gemini.md](clients/gemini.md) | stdio in the CLI. Not the Gemini web app. |
| Claude Code and Claude Desktop | [clients/claude.md](clients/claude.md) | stdio |
| ChatGPT | [clients/chatgpt.md](clients/chatgpt.md) | remote Streamable HTTP over HTTPS |

Project examples (command `node`, args `dist/mcp/server.js`, no secrets):

- `.cursor/mcp.json`
- `.gemini/settings.json`
- `.mcp.json`
- `config/clients/cursor.mcp.json`
- `config/clients/gemini.settings.json`

`toonforge setup --client <name>` prints the config it would write. Add `--apply` to merge it. ChatGPT is remote-only and is not written to disk.

## Smoke test (stdio)

After `npm run build`:

```bash
node dist/mcp/server.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
EOF
```

The tools/list result is JSON on stdout. A client is "connected" only after that client loads the config and lists tools. A valid JSON file is not the same as a live session inside ChatGPT, Cursor, Gemini, or Claude.

## Safety shared by every client

- `YOUTUBE_DRY_RUN=true` unless you change it.
- `dryRun: false` on an MCP tool does not enable live upload. The operator must also run `toonforge publish enable-live --i-understand` and set `YOUTUBE_DRY_RUN=false`.
- Tools do not return access tokens, refresh tokens, client secrets, or environment dumps.
- There is no shell-execution tool.
