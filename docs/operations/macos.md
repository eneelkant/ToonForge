# macOS verification checklist

The production render and automated suite for this repository were run on Linux. None of the checks below have been executed on macOS. Treat every item as unverified until it is run on a Mac.

Install the tools with Homebrew or the vendor installers. Point ToonForge at them with environment variables. Do not hard-code a machine path in the repository.

1. Node.js 22.14 or newer. `node --version`
2. Python 3.10 or newer for the OpenMontage checkout. `python3 --version`
3. FFmpeg and ffprobe on `PATH`. `ffmpeg -version` and `ffprobe -version`
4. An OpenMontage checkout. Set `OPENMONTAGE_ROOT` to that directory and `OPENMONTAGE_PYTHON` to its virtualenv Python. `OPENMONTAGE_ENABLED=true`
5. Playwright Chromium inside that same virtualenv. `OPENMONTAGE_PYTHON -m playwright install chromium`
6. Piper in its own virtualenv. Set `TOONFORGE_PIPER_PYTHON` to that interpreter and `TOONFORGE_PIPER_MODEL` to an absolute path of a public-domain voice such as `en_US-ljspeech-high.onnx`.
7. A local music file whose license is `public-domain`, `cc0-1.0`, `cc-by-4.0`, or `cc-by-3.0`. Set `TOONFORGE_MUSIC_FILE`, `TOONFORGE_MUSIC_LICENSE`, `TOONFORGE_MUSIC_TITLE`, `TOONFORGE_MUSIC_ATTRIBUTION`, and `TOONFORGE_MUSIC_SOURCE_URL`.
8. `npm ci`, then `npm run typecheck`, `npm run build`, `npm test`, and `npm run doctor`.
9. `npm run cli -- openmontage health` with OpenMontage enabled.
10. A history render only after those commands pass: `npm run cli -- workflow run daily --channel-config config/channels/mila-and-milo.yaml`

`npm test` must not inherit `OPENMONTAGE_ENABLED` or the Piper variables. The health test expects OpenMontage to be disabled unless a smoke test opts in.

YouTube OAuth stays a separate operator step. Do not commit client secrets, refresh tokens, voice models, or music files.
