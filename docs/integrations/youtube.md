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

Uploads must key on project/video ID. If upload outcome is unknown, require channel reconciliation before retry (pattern observed in AgentTube publishing agent).
