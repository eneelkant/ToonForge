# ToonForge

Turn trends into **original** animated videos — automatically.

Local-first, modular, MCP-first autonomous cartoon production and YouTube publishing platform (Apache-2.0).

## Quick start

```bash
npm install
cp .env.example .env
npm run doctor
npm test
npm run workflow:daily    # dry-run with valid FFmpeg media fixtures
npm run mcp               # MCP stdio server
```

## What it does

Trend → reference analysis → original story → characters → storyboard → cartoon production → voice/music → captions → thumbnail → metadata → QA → gated publish → analytics.

Reference videos may inspire **structure** (hook, pacing, shot rhythm). They must never be re-uploaded or copied as footage/characters/scripts/music.

## Docs

- [Architecture](docs/architecture.md)
- [Deployment](docs/deployment.md)
- [MCP client setup](docs/client-setup.md)
- [Dependency matrix](docs/integrations/dependency-matrix.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Troubleshooting](docs/troubleshooting/index.md)

## Upstream engines (adapters only)

| Role | Upstream | Notes |
|------|----------|--------|
| Characters | [OmniChar](https://github.com/omnichar/OmniChar) | GPL — process/HTTP isolation only (`:8848`) |
| Production | [ReelMimic](https://github.com/edenfunf/reelmimic) | MIT — local HTTP (`:4318`) + file contract |
| Guidance | Karpathy-skills concepts | Mapped into ToonForge-owned policies |
| YouTube | OAuth Data API adapter | Dry-run by default; idempotent manifests |
| Orchestration | [Ruflo](https://github.com/ruvnet/ruflo) | Optional; local orchestrator fallback |

## Media kinds

| Kind | Dry-run | Live YouTube |
|------|---------|--------------|
| `reelmimic` / `provider` | OK | OK |
| `ffmpeg_dev` (CI/dev FFmpeg fixture) | OK | **Blocked** |
| `invalid_stub` (text `.mp4` / `.bin`) | **FAIL** | **Blocked** |

## Safety

- Kill switch: `TOONFORGE_KILL_SWITCH`
- Budgets, retries, concurrency limits
- QA + provenance + ffprobe gates before publish
- `YOUTUBE_DRY_RUN=true` by default

## Docker

```bash
docker compose up --build
```

See [docs/deployment.md](docs/deployment.md).

## License

Apache-2.0 — see `LICENSE` and `THIRD_PARTY_NOTICES.md`.
