# ToonForge

ToonForge turns configured trend formats into **original** cartoon videos and can publish them to a YouTube channel you authorize. It is a local-first Node.js CLI and MCP server (Apache-2.0).

A dry-run on this machine produces a short FFmpeg fixture, QA, and a publication manifest. It does **not** upload to YouTube. Live upload needs your Google OAuth client, a connected channel, a real production backend, and an explicit opt-in. Those steps are not completed by installing the repository.

ToonForge is not published to the npm registry. Install from a checkout or a packed tarball you build yourself.

## What a run actually does

1. Reads a channel config (`config/channels/cartoon-default.yaml` by default).
2. Discovers trends from configured sources. The default source is `manual`. Optional YouTube Data API trends need a separate API key.
3. Builds an original story and storyboard from structural hints. It does not copy scripts, footage, or characters from a reference.
4. Renders with the selected backend: `offline_fixture` (FFmpeg, CI/dev), `reelmimic`, or `openmontage`. The last two are separate installs and are off by default.
5. Adds voice, music, captions, and a thumbnail. Voice, music, and thumbnail in the default path are labeled `ffmpeg_dev` placeholders, not a licensed TTS or music model.
6. Runs ffprobe and QA. `QA BLOCK` stops publishing.
7. Writes a dry-run publication manifest unless live publishing is explicitly enabled.

## Supported clients

One MCP tool implementation serves every client. Client files only choose how the process is started.

| Client | How you connect | Local stdio |
|--------|-----------------|-------------|
| Cursor | `.cursor/mcp.json` or `~/.cursor/mcp.json` | Yes, after `npm run build` |
| Gemini CLI | `.gemini/settings.json` or `~/.gemini/settings.json` | Yes. Gemini web does not use this file. |
| Claude Code | `.mcp.json` or `claude mcp add` | Yes |
| Claude Desktop | `claude_desktop_config.json` | Yes |
| ChatGPT (Developer Mode) | Remote HTTPS MCP URL plus a bearer token | No. ChatGPT does not launch a local stdio process. |

Details: [docs/client-setup.md](docs/client-setup.md).

## Install

Requirements: Node.js `>= 22.14`, FFmpeg, and ffprobe. Python 3.10+ is optional and only needed for OpenMontage or ReelMimic.

From a git checkout (no GitHub login, no remote shell script):

```bash
node scripts/bootstrap.mjs --install
node scripts/bootstrap.mjs --check
```

`--install` runs `npm ci` and `npm run build` in this directory, then `toonforge setup --check`. It does not download OpenMontage, ReelMimic, OmniChar, GPU drivers, or model weights.

After the build, the CLI is `node dist/cli/index.js`. A packed install can expose the `toonforge` bin:

```bash
npm pack
npm install -g ./toonforge-0.1.0.tgz   # optional; needs a writable global prefix
toonforge --help
```

`toonforge update` exits 3. There is no registry update path until a package is published.

### First run

```bash
cp .env.example .env
node dist/cli/index.js doctor
node dist/cli/index.js setup --check --non-interactive
node dist/cli/index.js workflow run daily
```

`setup` creates `~/.toonforge/config.env` from `.env.example` only when that file is absent. It does not overwrite an existing config. Pass `--home` to choose another directory. `--data-dir` selects the runtime data directory used by the scheduler and tokens when you pass the built CLI's normal config (`TOONFORGE_DATA_DIR`).

Register a client only after reading the preview:

```bash
node dist/cli/index.js setup --client cursor
node dist/cli/index.js setup --client cursor --apply --non-interactive
```

`--apply` merges a `toonforge` stdio entry into the client file. It replaces the `toonforge` key and leaves other MCP servers in place. ChatGPT setup prints a remote example and does not write a local file.

## Dependencies

Shared manifest: `config/dependencies.json`. `toonforge doctor` and `toonforge setup` both read it.

| Dependency | Required | Why |
|------------|----------|-----|
| Node.js >= 22.14 | Yes | CLI, MCP, scheduler |
| ffmpeg, ffprobe | Yes | Fixture media and validation |
| python3 >= 3.10 | No | OpenMontage / ReelMimic tools |
| git | No | Development checkouts only |

System packages may need administrator rights (`apt`, Homebrew). The ToonForge installer does not elevate itself. Optional engines stay separate because of license and size: ReelMimic (MIT), OpenMontage (AGPL-3.0), OmniChar (GPL-3.0).

## YouTube

Connect the channel you are allowed to manage. ToonForge never asks for a Google password and never asks you to paste a refresh token into a chat.

1. In Google Cloud, create an OAuth **desktop** client and enable YouTube Data API v3.
2. Add redirect URI `http://127.0.0.1:53682/` (or another loopback port above 1024).
3. Set `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and `YOUTUBE_REDIRECT_URI` in `.env`.
4. Run:

```bash
node dist/cli/index.js youtube connect
node dist/cli/index.js youtube status
node dist/cli/index.js youtube channels
node dist/cli/index.js youtube test
node dist/cli/index.js youtube disconnect --channel CHANNEL_ID
```

`youtube connect` opens `https://accounts.google.com/...`, listens on the loopback redirect, checks the OAuth `state` value, and stores the token at `YOUTUBE_TOKEN_PATH` and `data/youtube/tokens/<channelId>.json` with mode `0600` on Unix. `accounts.json` stores channel id, title, scopes, and the token path. It does not store the token itself. Status output omits token values.

Scopes requested: `youtube.readonly` and `youtube.upload`.

Google controls OAuth verification, consent-screen limits, and quota. This installer does not bypass them. If the app is in testing, only test users you added can authorize.

`youtube test` reports the same non-secret status as `youtube status`. It does not upload a video.

## Schedule

Default channel schedule is **disabled** (`schedule.enabled: false`) at `0 6 * * *` in `UTC`. The scheduler accepts a daily cron only: `"<minute> <hour> * * *"`. Other fields must be `*`. Times are interpreted in the channel IANA timezone, including daylight-saving gaps and overlaps (one run per local civil day).

```bash
node dist/cli/index.js scheduler preview
node dist/cli/index.js scheduler status
node dist/cli/index.js scheduler start --once
node dist/cli/index.js scheduler start          # loops until SIGINT/SIGTERM
node dist/cli/index.js scheduler pause
node dist/cli/index.js scheduler resume
node dist/cli/index.js pause --channel cartoon-default
node dist/cli/index.js resume --channel cartoon-default
```

`preview` prints the next local instants and does not generate or upload. State is under `TOONFORGE_DATA_DIR/scheduler/` (`state.json`, `control.json`, `lock.json`, `audit.jsonl`). A file lock (`wx`) stops a second scheduler from running the same tick. Stale locks are recovered after expiry.

Service templates (not installed for you): [config/services/README.md](config/services/README.md).

Jobs do not run when the kill switch is on, the scheduler or channel is paused, the schedule is disabled, the selected production backend is down, or live mode is requested while the backend is `offline_fixture`.

## Dry-run

```bash
node dist/cli/index.js workflow run daily
node dist/cli/index.js publish preflight
```

Expect a local project under `data/`, a valid short MP4, QA for the offline fixture, and a dry-run manifest. `publish preflight` lists blockers. With the default config those include `live_publishing_disabled`, `schedule_disabled`, and `offline_fixture_is_not_production_media`.

## Enable unattended live publishing

All of the following are required. An MCP argument `dryRun: false` is not enough.

1. `YOUTUBE_DRY_RUN=false` in the environment used by the scheduler.
2. `node dist/cli/index.js publish enable-live --i-understand`  
   This writes `data/live-publish.opt-in.json`. MCP tools cannot create that file.
3. `youtube status` reports `authClass: ready` for the selected channel.
4. Channel `schedule.enabled: true`, a real backend (`reelmimic` or `openmontage`) that probes ready, and production media (not `ffmpeg_dev`).
5. QA `PASS`. `WARN` is blocked for unattended public publishing.
6. Kill switch off (`TOONFORGE_KILL_SWITCH` is not `true`).
7. Budget remaining.

Turn it off:

```bash
node dist/cli/index.js publish disable-live
```

`DEFAULT_PRIVACY_STATUS` defaults to `private`. A local scheduler cron is not the same thing as a YouTube scheduled premiere. YouTube scheduling uses the Data API privacy and `publishAt` fields when a live upload runs.

## Where files live

| Data | Path |
|------|------|
| Env template you edit | `.env` (gitignored) |
| Setup copy, created once | `~/.toonforge/config.env` |
| Projects, manifests, scheduler | `TOONFORGE_DATA_DIR` (default `./data`) |
| Active OAuth token | `YOUTUBE_TOKEN_PATH` |
| Per-channel tokens | `data/youtube/tokens/<channelId>.json` |
| Channel index (no token values) | `data/youtube/accounts.json` |
| Live opt-in | `data/live-publish.opt-in.json` |
| Logs | stderr JSON. Tokens, secrets, and bearer strings are redacted. |

## Repair, uninstall, troubleshooting

- Repair: `node dist/cli/index.js doctor` and `node dist/cli/index.js setup --check`.
- Client config: rerun `setup --client <name>` to preview, then `--apply`. The merge keeps other servers.
- Disconnect a channel: `youtube disconnect --channel <id>` deletes that channel's token file and clears it if it was selected.
- Uninstall a packed global install: `npm uninstall -g toonforge`. Delete `~/.toonforge` and `data/` yourself if you want tokens and projects removed. Revoke the Google app access in the Google Account security page as well.
- `toonforge update` will not fetch a new version. Replace the checkout or tarball and rebuild.
- More cases: [docs/troubleshooting/index.md](docs/troubleshooting/index.md).

## Provider costs and limits

| Piece | Cost | If it is missing |
|-------|------|------------------|
| Offline fixture | Local CPU, FFmpeg | Doctor fails |
| YouTube upload | Google quota; OAuth verification for external users | Status class explains the failure; no upload |
| YouTube trends | Data API key quota | Source stays manual |
| ReelMimic | Separate MIT install; may need a coding-agent login upstream | Backend reports unavailable; no silent fixture fallback in live mode |
| OpenMontage | Separate AGPL checkout, Python, FFmpeg | Same |
| OmniChar | Separate GPL service | Character continuity check skipped unless enabled |
| TTS / music models | Not bundled | Audio and thumbnail stay `ffmpeg_dev` and fail live QA |

No real YouTube account is used by tests or CI.

## Security and license

- Apache-2.0. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.
- No arbitrary shell or filesystem tool in MCP.
- URL tools reject loopback, private, and link-local hosts.
- HTTP MCP (`toonforge mcp --http`) binds `127.0.0.1` only, requires `TOONFORGE_MCP_TOKEN`, limits body size and request rate. Put TLS on a reverse proxy. Do not expose it without the token.
- Do not commit `.env`, `data/`, or token files.

## Docs

- [Client setup](docs/client-setup.md)
- [Capabilities](docs/capabilities.md)
- [Deployment and scheduler](docs/deployment.md)
- [Installer](docs/operations/installer.md)
- [MCP](docs/mcp.md)
- [YouTube](docs/integrations/youtube.md)
- [Dependency matrix](docs/integrations/dependency-matrix.md)
