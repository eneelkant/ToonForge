# OpenMontage integration

OpenMontage is an **optional** production backend. ToonForge stays the product: trends, stories, characters, QA, provenance, and publishing do not move into OpenMontage.

Upstream: https://github.com/calesthio/OpenMontage  
License: **GNU AGPL-3.0** (`LICENSE` inspected at commit `9327439db69021ab4b0e2776729bf3b58fdb5a87`).  
Python: 3.10+ (`.python-version`, `setup.py`). Node 18+ and FFmpeg are upstream prerequisites. Playwright is required by `character_rig_renderer` when `render_video` is true.

ToonForge does not copy that source into this repository or into the Docker image. Enabling the backend means installing OpenMontage yourself and pointing `OPENMONTAGE_ROOT` at that checkout. Process isolation does not, by itself, decide AGPL obligations for a combined deployment. Operators who turn the backend on must follow the upstream license. This document is not legal advice.

## What is called

There is no production REST API. The adapter uses the character-animation tool classes:

| Tool | Role |
|------|------|
| `character_spec_generator` | Map ToonForge characters into a `character_design` artifact |
| `svg_rig_builder` | Rig plan |
| `pose_library_builder` | Pose library |
| `action_timeline_compiler` | Timeline from the ToonForge storyboard |
| `character_rig_renderer` | HTML preview plus MP4 when `render_video` is true |

`scripts/openmontage_runner.py` is ToonForge code. It puts `OPENMONTAGE_ROOT` on `sys.path` and calls `execute()`. The command is an argument array (`OPENMONTAGE_PYTHON`, runner path). The request is JSON on stdin. Credential-like environment variables are stripped before spawn, and API keys are never placed on the command line.

`video_compose` (Remotion, HyperFrames, FFmpeg encode) is not used as a fallback. If the selected render fails, the job fails.

Reference analysis stays with ReelMimic when a real reference exists and ReelMimic is enabled. Otherwise ToonForge writes its offline format report. OpenMontage's `video_downloader` is not called. A reference URL is not permission to reuse footage.

## Configuration

Disabled by default.

```bash
OPENMONTAGE_ENABLED=true
OPENMONTAGE_ROOT=/absolute/path/to/OpenMontage
OPENMONTAGE_PYTHON=python3
OPENMONTAGE_TIMEOUT_MS=120000
OPENMONTAGE_MAX_RETRIES=1
```

Select it explicitly. Turning the flag on does not change the default daily workflow.

```yaml
production_backend: openmontage   # or reelmimic, or offline_fixture
```

Or pass `pipelineMode: "openmontage"` to the daily workflow / `toonforge.generate_cartoon`.

```bash
node dist/cli/index.js workflow run daily --pipeline openmontage --channel-config config/channels/your-channel.yaml
```

`--publish` still cannot enable a live upload by itself. An optional `episode_concept` on the channel replaces the generic story template with up to three operator-written sentences. Those sentences are the scene beats. They are not fetched from a reference video.

Channel files that omit `production_backend` keep the previous behavior: ReelMimic when `REELMIMIC_ENABLED=true`, otherwise the offline FFmpeg fixture.

## Character mapping

ToonForge characters are the identity source. The mapper requires `character_id`, `display_name`, `canonical_description`, `allowed_styles`, and `personality`. Ids that OpenMontage's slug would rewrite are rejected. `canonical_description` is sent as both `body_type` and `silhouette_notes`. Wardrobe is `props`. Consistency flags are `constraints`.

`voice` has no field on the upstream character schema (`additionalProperties: false`). It is listed under `preservedLocally` and remains on the ToonForge character record and provenance. It is not dropped from the project, and it is not pretended to exist inside the upstream artifact.

`required_actions` defaults to `idle`, `blink`, `look`, and `gesture` because ToonForge characters do not store an action list. That derivation is recorded on the mapping.

## Artifacts and validation

The runner may write only under the project workspace `<data>/projects/<id>/openmontage/`. A path outside that directory is rejected. After a zero exit, ToonForge still requires a non-empty video inside the workspace, copies it to `out/video.mp4`, and runs ffprobe. Text files and empty files fail. The sidecar kind is `openmontage`, which is a production media kind for the video. The thumbnail for that run is one frame extracted from the rendered MP4 and keeps kind `openmontage`. Narration and music are not development tones on this path. The run speaks the story narration with Piper and mixes a local music file whose license is `public-domain`, `cc0-1.0`, `cc-by-4.0`, or `cc-by-3.0`. Anything else, including a missing model, fails before a tone is written. `ffmpeg_dev` remains the offline fixture only. The Lessac Blizzard voice is a research license and is not an accepted narration model. A public-domain Piper option is `en_US-ljspeech-high`.

The daily workflow passes the channel `duration_seconds` into story generation. Production then renders the storyboard shot sum, which is that requested duration after scene rounding. A preview render (`preview: true`) still clamps to 2–8 seconds. A production render above 120 seconds fails the runaway guard. That guard is not the preview cap. The offline FFmpeg fixture keeps its own 2–8 second clip.

The delivered picture is original ToonForge character art (`kind=provider`, `provider=toonforge-character-art`). OpenMontage still runs `character_spec_generator`, `svg_rig_builder`, `pose_library_builder`, and `action_timeline_compiler` with `render_video: false`, so the schematic MP4 is not the episode. Passing `characterArt: "adapter"` keeps that schematic file and labels it `openmontage`; it is not finished character art. Rasterizing the original SVG needs Playwright and ffmpeg in `OPENMONTAGE_PYTHON`. If they are missing, the job fails and does not substitute the schematic. Muxing pads a shorter audio bed so it does not cut the picture.

Max's arms are filled two-bone limbs with fingered hands. Look, gesture, and wonder move those arms through reach, fit, and wave, and the story prop is held or seated during that action. After the fitted narration exists, the daily workflow re-renders those frames from a 40 ms RMS amplitude envelope of that waveform. Piper's CLI does not emit phoneme timestamps, so this is not phoneme lip-sync. Frames drawn before a voice file exists use a deterministic letter-pulse approximation instead. A stereo licensed music file is mixed as stereo with the mono narration centered in that image. A mono music file stays mono; the pipeline does not duplicate it into two identical channels and call the result stereo. These checks were run on Linux. macOS compatibility is unverified.

## Approval, cost, and retries

The character-animation pipeline manifest marks proposal, script, character design, scene plan, assets, and publish as human-approval stages. Those gates belong to OpenMontage's agent checkpoint workflow. This adapter does not run that workflow and does not invent approval records. Results say `approval.agentPipeline = not_invoked`.

The local tools used here report `total_cost_usd: 0`. Paid providers are not invoked. A non-zero `estimatedCostUsd` is checked against the ToonForge budget before the render starts. The kill switch is checked again immediately before that render and again before publish.

Timeouts are retryable up to `OPENMONTAGE_MAX_RETRIES` attempts. Validation errors, path violations, compatibility errors, and ordinary process failures are not retried.

## Doctor and MCP

`npm run doctor` and `toonforge.openmontage_health` use the same status:

| Status | Meaning |
|--------|---------|
| `disabled` | `OPENMONTAGE_ENABLED` is not `true` |
| `ready` | Checkout markers import and tool versions return |
| `not_installed` | Root missing or required files missing |
| `missing_dependencies` | Python import failed on a missing module |
| `invalid_configuration` | Empty root, relative root, or missing Python |
| `health_check_failed` | Probe ran and failed for another reason |

A disabled or missing optional install is a doctor warning. It does not fail `npm test`.

`toonforge.production_backends` reports offline, ReelMimic, and OpenMontage availability. `npm run cli -- openmontage health` prints the same health object.

## Tests without OpenMontage

```bash
npm test
```

Unit and workflow tests mock the process runner or inject an adapter. They do not need the upstream checkout, API keys, or a GPU.

Set `OPENMONTAGE_SMOKE=1` and `OPENMONTAGE_ROOT` only when you want the skipped external smoke test to attempt a real probe. A checkout that cannot import is skipped with the probe status. It is not reported as a pass. This integration's default test run does not render an OpenMontage video.

## Known limits

- The full agent pipeline, Remotion `render_demo.py`, and HyperFrames `video_compose` are not the unattended path.
- Preview MP4 generation needs Playwright inside the OpenMontage environment. If it is missing, the job fails as `missing_dependencies` or `execution_failure`.
- Narration and music still come from ToonForge's audio engine.
- Do not treat a reference that was analyzed as footage that was reused. License status stays `unknown` unless a caller already marked it otherwise.
