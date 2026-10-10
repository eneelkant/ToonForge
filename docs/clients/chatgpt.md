# ChatGPT

ChatGPT's supported MCP path is a **remote connector** in Developer Mode: an HTTPS URL that speaks Streamable HTTP. ChatGPT does not start `toonforge mcp` on your laptop over stdio. A `.cursor/mcp.json`-style file does nothing in the ChatGPT UI.

There is no ToonForge app-store plugin and no invented plugin manifest.

## What ToonForge exposes

```bash
export TOONFORGE_MCP_TOKEN='choose-a-long-random-secret'
node dist/cli/index.js mcp --http
```

The process binds **127.0.0.1** only (port `TOONFORGE_MCP_PORT`, default 8787) at path `/mcp`. It requires `Authorization: Bearer <TOONFORGE_MCP_TOKEN>` compared in constant time. It rejects bodies over `TOONFORGE_MCP_MAX_BYTES` (default 262144) and allows 60 requests per minute per remote address. Sessions are created by the MCP SDK Streamable HTTP transport.

The server refuses to bind a public interface. Put TLS in a reverse proxy you control, or use OpenAI's documented secure MCP tunnel for Developer Mode, and forward to `http://127.0.0.1:8787/mcp` with the bearer header. Do not publish an unauthenticated endpoint.

## Preview

```bash
node dist/cli/index.js setup --client chatgpt
```

The command prints an example object (`transport`, `mcpServerUrl`, `authentication`). It does not write a file and it is not a store listing.

## Register in ChatGPT

Follow the current OpenAI Developer Mode steps for a custom MCP connector:

1. Use an HTTPS URL that reaches your proxy.
2. Configure bearer authentication with the same value as `TOONFORGE_MCP_TOKEN`.
3. Confirm the connector lists ToonForge tools such as `toonforge.system_status`.
4. Leave `YOUTUBE_DRY_RUN=true` on the server until you have completed YouTube setup and `publish enable-live`.

Developer Mode availability depends on the ChatGPT plan. ToonForge cannot enable it.

## Smoke test you can run locally

Without the token, `POST /mcp` returns 401. With the token, an MCP initialize request returns JSON. See the HTTP checks in the test plan in the pull request. That does not create a ChatGPT conversation.

## Safety

The HTTP server uses the same tools as stdio. `dryRun: false` still cannot live-publish by itself. OAuth tokens are not tool arguments and are not returned.
