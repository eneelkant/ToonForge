# Troubleshooting

- [Foundation checks](foundation.md)
- [Deployment](../deployment.md)

## Common issues

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| QA FAIL on video | Text placeholder / invalid stub | Use FFmpeg fixture or ReelMimic; never `TOONFORGE_LOCAL_RENDER` text files |
| Live publish blocked | `ffmpeg_dev` media or dry-run still on | Produce via ReelMimic; set `YOUTUBE_DRY_RUN=false` |
| Doctor WARN adapters | OmniChar/ReelMimic/YouTube not configured | Optional for local dry-run; required for production |
| ReelMimic unavailable | Server not running | `cd reelmimic && ./start.sh` then `REELMIMIC_ENABLED=true` |
| Kill switch FAIL | `TOONFORGE_KILL_SWITCH=true` | Set to `false` when safe |
