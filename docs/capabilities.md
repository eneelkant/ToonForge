# Capability matrix

Status words mean:

- **implemented** — the code path runs in the default dry-run and is covered by tests.
- **provider** — the code calls an external system you must install or authorize. If that system is absent, the stage waits or fails visibly.
- **placeholder** — the file is real enough for dry-run QA and is labeled so live publish rejects it.
- **stub** — no external effect; a local record only.

| Stage | Status | Module | Artifact | Validation | If it cannot run |
|-------|--------|--------|----------|------------|------------------|
| Trend discovery | implemented for `manual`; provider for YouTube Data API | trend engine, `src/adapters/youtube` trends | trend candidate JSON | source id recorded | Manual list still works. API errors stay on that provider. |
| Reference analysis | provider (ReelMimic) or explicit offline format notes | `src/engines/reference` | analysis report | No download of arbitrary footage. URL hosts that are private or loopback are blocked. | Offline mode uses structural hints and says so. It does not fetch a reference video. |
| Original story | implemented local template | story engine | story JSON | Originality flags; does not copy a source script | Fails the workflow if the story fails validation. |
| Characters | implemented local registry | `src/characters` | versioned character JSON | id and required fields | Missing character fails selection. OmniChar continuity is optional and off by default. |
| Storyboard | implemented | `src/engines/storyboard` | shot list with timings | duration and asset refs | Invalid board stops the workflow. |
| Cartoon production | provider or explicit fixture | `src/engines/production`, ReelMimic adapter, OpenMontage adapter | MP4 + provenance | ffprobe; kind `reelmimic`, `openmontage`, or `ffmpeg_dev` | Live mode does not fall back to `offline_fixture` after a backend failure. The scheduler skips the job when the selected backend is down. |
| Voice / dialogue | placeholder unless a provider is configured | `src/engines/audio` | audio file | kind `ffmpeg_dev` in the default path | Live QA blocks `ffmpeg_dev`. There is no bundled TTS model. |
| Music / SFX | placeholder | audio engine | audio file | same | Same. No bundled music model and no claim of a licensed library. |
| Captions, thumbnail, metadata | captions implemented locally; thumbnail is `ffmpeg_dev`; metadata is local text | caption / thumbnail / metadata engines | srt, image, metadata JSON | files exist | Thumbnail kind blocks live publish. |
| Media validation | implemented | `src/core/media.ts` | ffprobe result | codec, container, duration, streams, required audio | Corrupt or text-named `.mp4` files fail. |
| QA and provenance | implemented | QA engine | PASS / WARN / FAIL | originality, third-party footage, media kind | `FAIL` stops publish. `WARN` is not eligible for unattended public publish. |
| Publication eligibility | implemented | `src/engines/publish/preflight.ts`, YouTube gates | blocker list | live opt-in, dry-run flag, channel, backend, schedule, kill switch | Any blocker keeps the run in dry-run or skips it. |
| Upload and schedule | provider | `src/adapters/youtube` | publication manifest | idempotency key `pub:<projectId>:video`; unknown results become `reconciliation_required` and are not re-uploaded | Dry-run writes a manifest and does not call Google. |
| Analytics | stub for placeholders; provider when a video id exists and OAuth is ready | analytics engine | snapshot JSON | no token in the payload | Missing video id keeps the local placeholder. |
| Learning | stub | analytics recommendations | local notes | budgets unchanged | Does not retrain a model or change publish policy by itself. |

## Workflow states

The daily workflow still uses the existing states (`IDEA` through `SCHEDULED` / `FAILED`). Authorization is enforced before a live upload and in `publish preflight`. A failed run keeps the project directory and manifest so a later run can reconcile. Scheduler retries reuse the same `projectId` and `workflowId`, so the publish idempotency key stays stable.

## What is not bundled

Full AI animation, TTS, and music generation are not in this package. OpenMontage and ReelMimic are optional processes. Tests that cannot reach them are `SKIPPED / DEPENDENCY UNAVAILABLE`, not a pass.
