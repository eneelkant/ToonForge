# MCP client setup (index)

ToonForge exposes a **client-agnostic** MCP server. Business logic is identical for every client.

| Client | Guide |
|--------|-------|
| Claude | [docs/clients/claude.md](clients/claude.md) |
| Gemini | [docs/clients/gemini.md](clients/gemini.md) |
| Cursor | [docs/clients/cursor.md](clients/cursor.md) |
| ChatGPT | [docs/clients/chatgpt.md](clients/chatgpt.md) |

## Start the server

```bash
cd /path/to/ToonForge
npm install
npm run mcp
```

stdio is the default transport. Configure your client to run that command.

## Safety

- Default YouTube mode is dry-run (`YOUTUBE_DRY_RUN=true`).
- Kill switch: `TOONFORGE_KILL_SWITCH=true`.
- Never pass secrets through MCP tool arguments; use env/files outside the chat.
- See [deployment.md](deployment.md) for production publishing gates.
