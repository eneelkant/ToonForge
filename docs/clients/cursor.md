# Cursor

Cursor starts a local stdio MCP server from `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (user). This matches the current Cursor MCP config: `mcpServers.<name>.command`, `args`, and `env`.

## Project config

`.cursor/mcp.json` in this repo:

```json
{
  "mcpServers": {
    "toonforge": {
      "command": "node",
      "args": ["dist/mcp/server.js"],
      "env": {
        "YOUTUBE_DRY_RUN": "true",
        "TOONFORGE_LOG_LEVEL": "error"
      }
    }
  }
}
```

Run it from the repository root after `npm run build`. `node` must be on PATH.

## Installed CLI

When the `toonforge` bin is on PATH (packed tarball or `npm link`):

```bash
node dist/cli/index.js setup --client cursor
node dist/cli/index.js setup --client cursor --apply --non-interactive
```

Without `--apply`, setup only prints the JSON. `--apply` merges the `toonforge` server into `~/.cursor/mcp.json` and leaves other servers in place. The generated command is `toonforge` with args `["mcp"]`. Environment values are `YOUTUBE_DRY_RUN=true` and `TOONFORGE_LOG_LEVEL=error`. Put API keys in `.env` or the user environment, not in the JSON.

## Smoke test

1. Build or install so the command in the config exists.
2. Reload MCP servers in Cursor.
3. Ask the agent to call `toonforge.system_status` or confirm the tool list includes `toonforge.doctor`.

A green `setup --check` does not by itself prove Cursor loaded the server. That only happens inside Cursor.

## What this is not

Cursor does not install ToonForge from an extension marketplace in this repo. There is no Cursor plugin package.
