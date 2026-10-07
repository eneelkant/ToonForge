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

When `RUFLO_ENABLED=false` or Ruflo is unavailable, `LocalWorkflowRunner` executes the same interfaces in-process.
