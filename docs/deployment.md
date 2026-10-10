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

1. Create a Google Cloud OAuth desktop client and enable YouTube Data API v3.
2. Set the redirect to a loopback URL with a port, for example `http://127.0.0.1:53682/`.
3. Set `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and `YOUTUBE_REDIRECT_URI`.
4. Run `node dist/cli/index.js youtube connect`. The CLI opens Google's authorization page and stores the refresh token under `YOUTUBE_TOKEN_PATH` and `data/youtube/tokens/<channelId>.json` (mode 0600). It never asks for a Google password.
5. Confirm with `youtube status` (`authClass: ready`) and `youtube channels`.

Keep `YOUTUBE_DRY_RUN=true` until QA, provenance, and media validation all PASS with production media (`reelmimic` or `openmontage` — not `ffmpeg_dev`).

Live publish needs both the environment flag and the operator opt-in file:

```bash
node dist/cli/index.js publish enable-live --i-understand
YOUTUBE_DRY_RUN=false node dist/cli/index.js workflow run daily --publish
```

`publish enable-live` alone does nothing while `YOUTUBE_DRY_RUN` is still true. MCP `dryRun: false` cannot create the opt-in file.

## Scheduler

`toonforge scheduler start` reads the channel cron (`"<minute> <hour> * * *"`) in the channel IANA timezone and persists jobs under `TOONFORGE_DATA_DIR/scheduler`. Use a persistent disk for that directory. Two processes take a file lock so they do not run the same job. Default channel schedules are disabled, and unattended jobs stay in dry-run until live publishing is opted in.

User service templates are in `config/services/`. The installer does not register them and does not use sudo.

```bash
node dist/cli/index.js scheduler preview
node dist/cli/index.js scheduler start --once
```

## HTTP MCP

`toonforge mcp --http` listens on `127.0.0.1` and requires `TOONFORGE_MCP_TOKEN`. Terminate TLS on a reverse proxy if ChatGPT Developer Mode must reach it. Do not publish port 8787 on `0.0.0.0`.

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
- `YOUTUBE_DRY_RUN=false` and `data/live-publish.opt-in.json` from `publish enable-live --i-understand`
- OAuth credentials present for the selected channel id
- media kind is production-ready (`ffmpeg_dev` blocked)
- selected backend is not `offline_fixture`

## Monitoring

```bash
node dist/cli/index.js doctor
node dist/cli/index.js youtube status
node dist/cli/index.js scheduler status
node dist/cli/index.js publish preflight
```

Structured logs go to stderr and redact tokens. They include workflow id, project id, channel id, state, and QA verdict when the workflow emits them.

## Multi-channel

Channel configs live under `config/channels/*.yaml`. Same codebase; no per-channel forks. Secrets stay in env, not Git.
