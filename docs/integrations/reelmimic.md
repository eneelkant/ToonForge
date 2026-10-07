# ReelMimic Integration Notes

- Upstream: https://github.com/edenfunf/reelmimic
- License: MIT (verified) + third-party notices for bundled skills
- Adapter: `src/adapters/reelmimic/`
- Default server: `http://127.0.0.1:4318`

## Setup

```bash
git clone https://github.com/edenfunf/reelmimic.git
cd reelmimic
./install.sh
./start.sh   # http://localhost:4318
```

Requirements (upstream): Node ≥ 22.18, Python ≥ 3.10, FFmpeg, Chrome, Claude Code or Codex CLI.

## Verified HTTP API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/agents` | health / installed agent CLIs |
| GET/POST | `/api/projects` | list / create (multipart: reference or url, brief, agent, lang) |
| GET | `/api/projects/:id` | snapshot |
| POST | `/api/projects/:id/approve` | approve plan |
| POST | `/api/projects/:id/resume` · `/retry` · `/cancel` | control |
| GET | `/api/projects/:id/events` | SSE |
| GET | `/files/:id/*` | project files (e.g. `analysis/report.json`, `out/video.mp4`) |

## Analysis CLI

```bash
python3 .claude/skills/video-clone/scripts/analyze.py <file-or-url> --out <dir>
```

Writes `report.json` (duration, shots, pacing, audio, etc.).

ToonForge uses `REELMIMIC_ROOT` to locate this script. Without it, `analyzeReference` writes a structured **analysis placeholder** for local development (structure fields only — never production footage).

Production video must come from a healthy ReelMimic server (`REELMIMIC_ENABLED=true`). When ReelMimic is offline, dry-run/CI uses **valid FFmpeg fixtures** marked `kind=ffmpeg_dev`. Those fixtures are **blocked** from live YouTube publish.

## Env

```
REELMIMIC_ENABLED=true
REELMIMIC_BASE_URL=http://127.0.0.1:4318
REELMIMIC_ROOT=/path/to/reelmimic
REELMIMIC_TIMEOUT_MS=30000
REELMIMIC_MAX_RETRIES=3
```

## Originality rule

Reference videos are for structure/pacing analysis only. Do not feed copyrighted third-party footage into production as reusable assets. Production briefs must request **original** characters, scripts, and visuals.
