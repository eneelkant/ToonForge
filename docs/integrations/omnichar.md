# OmniChar Integration Notes

- Upstream: https://github.com/omnichar/OmniChar
- License: GPL-3.0-or-later (verified in `LICENSE` and package metadata)
- Adapter: `src/adapters/omnichar/`

## Verified runtime surface

- Health: `GET /v1/health`
- Models: `GET /v1/models`
- Runs: `POST /v1/runs`, `GET /v1/runs/{id}`, WS `/v1/runs/{id}/events`
- Assets: `POST /v1/assets`
- Takes: `GET /v1/takes/{id}`, `GET /v1/takes/{id}/bytes`
- Default bind: `127.0.0.1:8848`

## `.char` container (verified)

Zip with `manifest.json` first member; magic `INLINECHAR`; `format_version` 1.  
Refs/text are source of truth; payloads/scoring are regenerable cache.

## ToonForge usage

`OmniCharAdapter` may:

- probe availability
- resolve a character directory to an optional `.char` path
- (later) submit encode/score graphs via HTTP

Must not import GPL Python packages into the Node process.
