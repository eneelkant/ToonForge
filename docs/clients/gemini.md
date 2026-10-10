# Gemini CLI

This page is for the **Gemini CLI** (and other local agents that read `mcpServers` from settings). The Gemini web app and Gemini in Google AI Studio do not load `~/.gemini/settings.json`.

Official CLI shape (verified against the Gemini CLI MCP docs): a JSON object with `mcpServers`. Each entry has `command` and `args` for stdio, or `httpUrl` for a remote server. User settings live in `~/.gemini/settings.json`. A project can use `.gemini/settings.json`.

## Project example

`.gemini/settings.json`:

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

## Setup command

```bash
node dist/cli/index.js setup --client gemini
node dist/cli/index.js setup --client gemini --apply --non-interactive --home "$HOME"
```

`--apply` writes `~/.gemini/settings.json` and merges only the `toonforge` key.

## Smoke test

From a built checkout, the same stdio initialize and `tools/list` sequence in [client-setup.md](../client-setup.md) shows the server speaks MCP. Inside Gemini CLI, `/mcp` (or the CLI's MCP list command in your version) should show `toonforge` after the settings file is loaded. Restart the CLI after editing settings.

## Remote

If you already run `toonforge mcp --http` behind TLS, a Gemini CLI entry can use `httpUrl` instead of `command`. That URL must not be world-readable without the bearer token. See [chatgpt.md](chatgpt.md) for the HTTP server rules. Gemini web still does not consume this config.
