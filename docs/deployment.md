# ToonForge deployment

## Architecture separation

| Component | How it runs | License |
|-----------|-------------|---------|
| **ToonForge** | This service (Node MCP/CLI) | Apache-2.0 |
| **ReelMimic** | Separate process/HTTP on `:4318` | MIT — do not vendor into image |
| **OpenMontage** | Separate checkout; Python tools via `OPENMONTAGE_ROOT` | AGPL-3.0 — do not vendor into image |
| **OmniChar** | Separate process/HTTP on `:8848` | GPL — **network isolation only** |
| **YouTube** | OAuth + Data API | Credentials via env/secrets |
| **Data** | Persistent volume `/data` | Projects, manifests, tokens |
| **Logs / media** | Volumes `/logs`, `/generated`, `/published` | Ephemeral OK if backed up |

Never bake secrets into Docker images. Never copy OmniChar GPL source into ToonForge.

## Environment variables

See `.env.example`. Critical flags:

```bash
OMNICHAR_ENABLED=false
OMNICHAR_BASE_URL=http://127.0.0.1:8848
REELMIMIC_ENABLED=false
REELMIMIC_BASE_URL=http://127.0.0.1:4318
OPENMONTAGE_ENABLED=false
OPENMONTAGE_ROOT=/absolute/path/to/OpenMontage
REELMIMIC_ROOT=/path/to/reelmimic   # optional local analyze.py
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_TOKEN_PATH=./data/youtube-token.json
YOUTUBE_DRY_RUN=true                 # must be false for live upload
TOONFORGE_KILL_SWITCH=false
TOONFORGE_DATA_DIR=./data
```

## Local development

```bash
npm install
cp .env.example .env
npm run doctor
npm test
npm run workflow:daily          # dry-run with valid FFmpeg fixtures
npm run mcp                     # MCP stdio server
```

### ReelMimic setup

```bash
cd /path/to/reelmimic
./install.sh
./start.sh                      # http://localhost:4318
```

Then:

```bash
export REELMIMIC_ENABLED=true
export REELMIMIC_BASE_URL=http://127.0.0.1:4318
export REELMIMIC_ROOT=/path/to/reelmimic
npm run cli -- reelmimic health
```

### OmniChar setup

Run OmniChar Core separately. Set:

```bash
export OMNICHAR_ENABLED=true
export OMNICHAR_BASE_URL=http://127.0.0.1:8848
npm run cli -- omnichar health
```

### YouTube OAuth

1. Create a Google Cloud OAuth desktop client.
2. Set `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`.
3. Complete OAuth and store the refresh token at `YOUTUBE_TOKEN_PATH` (never commit).
4. Keep `YOUTUBE_DRY_RUN=true` until QA + provenance + media validation all PASS with **production** media (`reelmimic` / `provider` kinds — not `ffmpeg_dev`).

Live publish:

```bash
YOUTUBE_DRY_RUN=false npm run cli -- workflow run daily --publish
```

## Docker

```bash
cp .env.example .env
# edit .env — do not put secrets in the Dockerfile
docker compose up --build -d
docker compose exec toonforge node dist/cli/index.js doctor
```

Point `REELMIMIC_BASE_URL` / `OMNICHAR_BASE_URL` at host services via `host.docker.internal`.

## Media kinds (important)

| Kind | Meaning | Dry-run | Live YouTube |
|------|---------|---------|--------------|
| `reelmimic` | Real ReelMimic output | OK | OK |
| `openmontage` | Validated OpenMontage character render | OK | OK for the video; audio may still be `ffmpeg_dev` |
| `provider` | Real TTS/brand provider | OK | OK |
| `ffmpeg_dev` | Valid FFmpeg CI/dev fixture | OK | **BLOCKED** |
| `invalid_stub` | Text placeholder / `.bin` | **FAIL** | **BLOCKED** |

## Safety gates

Live upload requires:

- QA = PASS (WARN blocked)
- ffprobe-valid video + audio
- provenance complete + original content
- no third-party footage
- kill switch off
- `YOUTUBE_DRY_RUN=false`
- OAuth credentials present
- media kind is production-ready

## Monitoring

```bash
npm run cli -- system status
npm run doctor
# structured logs include workflowId, projectId, channelId, state, QA verdict
```

## Multi-channel

Channel configs live under `config/channels/*.yaml`. Same codebase; no per-channel forks. Secrets stay in env, not Git.
