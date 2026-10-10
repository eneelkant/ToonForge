# YouTube Integration Notes

## Repository resolution

| Candidate | Result |
|-----------|--------|
| `darkzOGx/youtube-automation-agent-` | **404 / unresolved** |
| `darkzOGx/youtube-automation-agent` | **Available** (canonical) |
| `Fork-Auto-SocialBots/youtube-automation-agent` | Mirror; not primary |

License of canonical repo: MIT (verified `LICENSE`).

## Required ToonForge capabilities

Implement via `YoutubeAdapter`:

- authenticate, validate_metadata, upload, schedule, publish, update, get_video, get_analytics, pause_publishing

## Credentials

From `.env.example`:

- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REDIRECT_URI`
- `YOUTUBE_TOKEN_PATH`
- `DEFAULT_PRIVACY_STATUS`

Use Google Cloud OAuth **Desktop** client with YouTube Data API v3 enabled.

## Idempotency

Uploads key on `pub:<projectId>:<videoId>`. Manifests are stored under `data/publish-manifests/`.
Replays return the prior result without a second upload.

If upload outcome is unknown (no video id), status becomes `reconciliation_required`.

## Dry run

Default `YOUTUBE_DRY_RUN=true` (also `dryRunDefault` on the adapter). Dry-run writes a publication
manifest and does **not** call YouTube.

## Gates

Publishing requires:

- workflow state `READY_TO_PUBLISH` (when provided)
- QA not `FAIL`
- policy not `FAIL`
- `originalContent: true` and no `thirdPartyFootage`
- video (and thumbnail if set) exist on disk

## OAuth

Desktop OAuth client. Redirect URI must be `http://127.0.0.1` or `http://localhost` with a port other than 80.

```bash
node dist/cli/index.js youtube connect
node dist/cli/index.js youtube status
node dist/cli/index.js youtube channels
node dist/cli/index.js youtube test
node dist/cli/index.js youtube disconnect --channel CHANNEL_ID
```

`youtube connect` uses a loopback listener, a random `state` value checked with `timingSafeEqual`, and a bounded timeout. The browser opener only launches `https://accounts.google.com/...` as an argument to `open`, `xdg-open`, or `cmd /c start`. Scopes are `https://www.googleapis.com/auth/youtube.readonly` and `https://www.googleapis.com/auth/youtube.upload`.

Tokens are written to `YOUTUBE_TOKEN_PATH` and `data/youtube/tokens/<channelId>.json` with mode `0600` when the platform supports it. `data/youtube/accounts.json` records channel id, title, scopes, and path. Status JSON never includes token strings. One token file maps to one channel id. Knowing a channel id is not treated as write access; `channels.list(mine=true)` must return that channel.

`authClass` is one of: `ready`, `oauth_app_missing`, `authorization_incomplete`, `token_expired`, `insufficient_scope`, `channel_unavailable`, `quota_exceeded`, `verification_required`.

Google's verification, testing-mode user list, and quota are not bypassed. Tests use injected fake token exchanges. CI does not call Google.

## Idempotent upload

A manifest in `published`, `scheduled`, `dry_run`, or `reconciliation_required`, or any manifest that already has a `youtubeId`, is not uploaded again. Unknown outcomes stay in `reconciliation_required` until a later status read resolves them.

## Live gate

Live upload requires `YOUTUBE_DRY_RUN=false` and `data/live-publish.opt-in.json` (`publish enable-live --i-understand`). Token contents are never logged.
