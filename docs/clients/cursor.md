# ToonForge MCP — cursor

## Start server

```bash
cd /path/to/ToonForge
npm install
npm run mcp
```

## Configure cursor

Use stdio MCP:

- command: `node`
- args: `["--import", "tsx", "src/mcp/server.ts"]`
- cwd: ToonForge repo root

No cursor-specific business logic. All clients share the same tools.

## Auth / env

Copy `.env.example` → `.env`. Never put secrets in MCP tool arguments.

## Example

1. `toonforge.system_status`
2. `toonforge.openmontage_health` (disabled unless `OPENMONTAGE_ENABLED=true`)
3. `toonforge.run_daily_workflow` with `dryRun: true`
4. Inspect QA + publication manifest

## Security

- Dry-run publish by default
- `toonforge.pause` available
- No shell execution tool
