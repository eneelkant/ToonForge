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
| OpenMontage not_installed / missing_dependencies | Checkout or Python deps absent | Install OpenMontage separately and set `OPENMONTAGE_ROOT`. Tests do not need it. |
| OpenMontage job failed | Renderer, timeout, or invalid media | Read `errorClass` on the workflow error. There is no silent fallback to FFmpeg. |
| OpenMontage daily run is QA FAIL | Audio or thumbnail is still `ffmpeg_dev` | Only `offline_fixture` may pass those fixtures. The OpenMontage video can be valid while narration, music, and the thumbnail still block publish. |
| `dryRun: false` still dry-runs | Live opt-in is missing | Set `YOUTUBE_DRY_RUN=false` and run `toonforge publish enable-live --i-understand`. An MCP flag cannot do this alone. |
| Scheduler did not run | Channel schedule disabled, pause, or kill switch | `toonforge scheduler status` and `toonforge scheduler preview`. Default channel schedule is disabled. |
| ChatGPT cannot see stdio | ChatGPT uses remote MCP | Use `toonforge mcp --http` behind HTTPS, or an OpenAI Secure MCP Tunnel. See `docs/clients/chatgpt.md`. |
| Kill switch FAIL | `TOONFORGE_KILL_SWITCH=true` | Set to `false` when safe |
