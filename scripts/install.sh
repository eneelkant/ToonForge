#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== ToonForge install =="
node -v
npm -v
npm ci
npm run build
npm run doctor || true
echo "Done. Start MCP with: npm run mcp"
echo "Dry-run daily workflow: npm run workflow:daily"
