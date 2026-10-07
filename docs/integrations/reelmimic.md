# ReelMimic Integration Notes

- Upstream: https://github.com/edenfunf/reelmimic
- License: MIT (verified) + third-party notices for bundled skills
- Adapter: `src/adapters/reelmimic/`

## Verified runtime surface

- Install: `./install.sh`
- Start: `./start.sh` → http://localhost:4318
- Doctor: `cd app && npm run doctor`
- Analysis CLI: `python analyze.py <file-or-url> --out <dir>` → `report.json`
- HTTP project lifecycle: create / message / approve / resume / retry / cancel / events

## Mapping to ToonForge

| ToonForge | ReelMimic |
|-----------|-----------|
| `reference.analyze` | `analyze.py` / analyzing stage |
| `production.plan` | planning / plan.json / STORYBOARD.md |
| `production.generate_*` | producing stage |
| `production.validate_output` | critique / out/video.mp4 presence |

Requires operator AI CLI (Claude Code or Codex). ToonForge must fail cleanly if the server is down.
