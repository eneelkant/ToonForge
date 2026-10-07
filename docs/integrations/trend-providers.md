# Trend providers

Channel YAML `trend_sources` selects providers via `createTrendProviders()` / `discoverTrendsForChannel()`.

## Documented source names

| Name | Implementation | Notes |
|------|----------------|-------|
| `manual` | `ManualSeedTrendProvider` | Deterministic offline seeds (default) |
| `manual-seed` | same | Alias |

Unknown names fail with `CONFIG_INVALID`. There is **no** fabricated live-scrape provider.

To add a real provider later: register it in `src/engines/trend/providers/index.ts` and document the name here. Do not scrape platforms in ways that violate their terms.

## MCP / workflow

- `toonforge.discover_trends` reads the channel's `trend_sources`
- `runDailyWorkflow` uses the same factory (no hardcoded `new ManualSeedTrendProvider()`)
