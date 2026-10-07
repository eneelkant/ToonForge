# OmniChar Integration Notes

- Upstream: https://github.com/omnichar/OmniChar
- License: GPL-3.0-or-later (verified in `LICENSE` and package metadata)
- Adapter: `src/adapters/omnichar/`
- Default bind: `http://127.0.0.1:8848`

## Verified runtime surface

Engine (`/v1`):

- Health: `GET /v1/health`
- Models: `GET /v1/models`
- Runs: `POST /v1/runs`, `GET /v1/runs/{id}`, WS `/v1/runs/{id}/events`
- Assets: `POST /v1/assets`
- Takes: `GET /v1/takes/{id}`, `GET /v1/takes/{id}/bytes`

Studio RPC (`POST /rpc` with `{ "channel", "args" }`):

- `characters:list`
- `characters:createFromTake` `(takeId, name)`
- `characters:delete`
- `characters:applyFal`
- `characters:sweepResult`

Character file routes:

- `POST /upload/character?name=...`
- `GET /download/character/{name}`
- `GET /character-ref/{name}/{index}`

## `.char` container (verified)

Zip with `manifest.json` first member; magic `INLINECHAR`; `format_version` 1.  
Refs/text are source of truth; payloads/scoring are regenerable cache.

## ToonForge usage

`OmniCharAdapter` (HTTP-only, injectable `fetch`):

- `probe` / `health`
- `listCharacters` / `getCharacter`
- `encodeFromTake` → `characters:createFromTake`
- `uploadCharFile` → `/upload/character`
- `validateContinuity` using list metadata (`needsRebuild`)
- `resolveCharArtifact` for local `characters/<id>/*.char`

Env:

- `OMNICHAR_ENABLED=true`
- `OMNICHAR_BASE_URL=http://127.0.0.1:8848`
- `OMNICHAR_TIMEOUT_MS=10000`
- `OMNICHAR_MAX_RETRIES=3`

Must not import GPL Python packages into the Node process.
