# Ruflo Integration Notes

- Upstream: https://github.com/ruvnet/ruflo
- npm: `ruflo` / `claude-flow` (MIT verified)
- Adapter: `src/adapters/ruflo/`

## Verified entry points

```bash
npx ruflo@latest init wizard
npx -y ruflo@latest mcp start
```

## ToonForge APIs (product-facing)

- `workflow.start|pause|resume|cancel|status`
- `agent.dispatch|status|retry|stop`

When `RUFLO_ENABLED=false` or Ruflo is unavailable, `LocalOrchestrator` executes the same interfaces in-process.

## Probe

`probeRufloCli()` runs `npx -y ruflo@latest --version` with timeout (`RUFLO_PROBE_TIMEOUT_MS`).

If Ruflo is enabled but unreachable, ToonForge logs a warning and **continues using the local runner** so MCP/workflow APIs stay available.

## Public API (stable)

Callers use `createOrchestrator(config)` only — never Ruflo CLI details:

- `workflow.start|pause|resume|cancel|status`
- `agent.dispatch|status|retry|stop`
- `registerAgent` / `listAgents` (local)
