# Claude Code and Claude Desktop

Both speak MCP. They use different config files. Neither one is implied by the other.

## Claude Code

Project file `.mcp.json` (this repo includes one that runs `node dist/mcp/server.js`):

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

Equivalent user-level registration, after `toonforge` is on PATH:

```bash
claude mcp add toonforge -- toonforge mcp
```

Set `YOUTUBE_DRY_RUN=true` in the environment Claude Code inherits. Do not put client secrets in the command line; they end up in shell history and process lists.

`toonforge setup --client claude` prints a Claude Code-style `mcpServers` document. `--apply` writes the **Claude Desktop** path for the current OS (below), because that is the file Desktop reads. If you use Claude Code only, copy the preview into `.mcp.json` or use `claude mcp add` instead of `--apply`.

## Claude Desktop

| OS | File |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

```bash
node dist/cli/index.js setup --client claude --apply --non-interactive
```

Restart Claude Desktop after the file changes. The command must be an absolute path or a `toonforge` bin visible to Desktop, which often does not inherit a developer shell PATH. Prefer an absolute `node` and `dist/mcp/server.js` if the bin is missing inside the app.

## Smoke test

Stdio smoke: [client-setup.md](../client-setup.md).

In Claude Code, `claude mcp list` should include `toonforge` after registration. Then call `toonforge.system_status`. In Claude Desktop, the tool list should show the same names after restart. This repository's automated tests check the JSON shape, not a running Claude process.
