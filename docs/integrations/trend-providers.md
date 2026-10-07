# Trend providers

Channel YAML `trend_sources` selects providers via `createTrendProviders()` / `discoverTrendsForChannel()`.

## Documented source names

| Name | Implementation | Notes |
|------|----------------|-------|
| `manual` | `ManualSeedTrendProvider` | Deterministic offline seeds (default) |
| `manual-seed` | same | Alias |
| `youtube` | `YoutubeTrendProvider` | Official YouTube Data API v3 `videos?chart=mostPopular` |

Unknown names fail with `CONFIG_INVALID`.

Do **not** scrape YouTube HTML or use unofficial APIs.

## YouTube live trends

### Env (API key — separate from OAuth publish)

```bash
TOONFORGE_YOUTUBE_TRENDS_ENABLED=true
YOUTUBE_DATA_API_KEY=...          # Data API key only
YOUTUBE_TRENDS_REGION=US
YOUTUBE_TRENDS_CATEGORY_ID=       # optional videoCategoryId
YOUTUBE_TRENDS_MAX_RESULTS=25
```

Publishing still uses `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` OAuth. Do not reuse OAuth tokens as the trend API key.

### Channel config

Keep CI/default deterministic:

```yaml
# config/channels/cartoon-default.yaml
trend_sources:
  - manual
```

Live example:

```yaml
# config/channels/cartoon-youtube-trends.example.yaml
trend_sources:
  - youtube
```

Combinations are supported (`youtube` + `manual`). If `youtube` is listed and credentials are missing/enabled-false, discovery **fails clearly** — it does not silently drop YouTube and continue with manual alone unless manual is also listed and YouTube is not.

### API usage

`GET https://www.googleapis.com/youtube/v3/videos`
`part=snippet,contentDetails,statistics&chart=mostPopular`

Quota: each call consumes standard Data API units; keep `maxResults` modest.

### Scoring methodology

Candidates are scored with existing `scoreTrend()`, not raw view count.

| Signal | Derivation |
|--------|------------|
| freshness | from `publishedAt` (decays over ~14 days) |
| engagement | (likes+comments)/views, normalized |
| velocity | **snapshot proxy**: log-scaled views/hour — **not** measured time-series velocity |
| nicheFit | keyword overlap vs `channel.niche` |
| originality | conservative inverse of popularity |
| saturation | log-scaled views |
| policyRisk | conservative title/description heuristics |

### Reference URL semantics

Each candidate includes:

- `source = "youtube"`
- `source_url = https://www.youtube.com/watch?v=<id>`
- `references: [source_url]`

The URL is for **format/reference analysis** (e.g. ReelMimic). It is **not** a license to reuse footage, audio, characters, or scripts.

Provenance must keep:

- reference analyzed ≠ source footage reused
- `thirdPartyFootage = false` unless an authorized reuse path is used

### Offline / CI

Default channel stays on `manual`. Unit tests mock HTTP and never call the live API.

## MCP / workflow

- `toonforge.discover_trends` reads the channel's `trend_sources` and passes `youtubeTrends` runtime config into the factory
- `runDailyWorkflow` uses the same factory
