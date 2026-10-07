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

Desktop OAuth client + token file at `YOUTUBE_TOKEN_PATH`. Token contents are never logged.
