# ToonForge MCP server

Version: tool list in `src/mcp/server.ts` (`0.1.0`). One handler module for every client.

## stdio

```bash
npm run build
node dist/mcp/server.js
# development, from source:
npm run mcp
```

Diagnostics go to stderr. Do not print extra text on stdout.

## HTTP (ChatGPT and other remote clients)

```bash
TOONFORGE_MCP_TOKEN='long-random-secret' node dist/cli/index.js mcp --http
```

- Bind: `127.0.0.1` only. A public host is rejected.
- Path: `/mcp`
- Auth: `Authorization: Bearer` matching `TOONFORGE_MCP_TOKEN`
- Body limit: `TOONFORGE_MCP_MAX_BYTES` (default 262144)
- Rate limit: 60 requests per minute per address
- TLS: terminate it on your reverse proxy

## Tools

Arguments are validated with Zod (`src/mcp/validate.ts`) before the handler runs. Unknown fields are rejected. Oversized argument JSON is rejected.

Operational tools include doctor, trends, story, storyboard, production, QA, publish, workflow, and:

- `toonforge.setup_status`
- `toonforge.youtube_status`
- `toonforge.scheduler_status`
- `toonforge.scheduler_preview`
- `toonforge.publish_preflight`
- `toonforge.pause_channel` / `toonforge.resume_channel`

Not exposed: OAuth callback URLs as a way to submit tokens, access tokens, refresh tokens, client secrets, environment dumps, shell commands.

## Errors

Tool failures return `isError: true` and JSON with `code`, `message`, `retryable`, and `remediation` when the error is a `ToonForgeError`. Stack traces are not included.

## Live publish

`toonforge.publish_video` and `toonforge.run_daily_workflow` accept `dryRun`. `false` only *requests* live mode. The server still runs dry-run unless `YOUTUBE_DRY_RUN=false` and `data/live-publish.opt-in.json` exists. QA `FAIL` cannot be cleared by a tool argument.

Client setup: [client-setup.md](client-setup.md).
