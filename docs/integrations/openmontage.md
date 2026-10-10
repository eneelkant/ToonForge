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

Channel files that omit `production_backend` keep the previous behavior: ReelMimic when `REELMIMIC_ENABLED=true`, otherwise the offline FFmpeg fixture.

## Character mapping

ToonForge characters are the identity source. The mapper requires `character_id`, `display_name`, `canonical_description`, `allowed_styles`, and `personality`. Ids that OpenMontage's slug would rewrite are rejected. `canonical_description` is sent as both `body_type` and `silhouette_notes`. Wardrobe is `props`. Consistency flags are `constraints`.

`voice` has no field on the upstream character schema (`additionalProperties: false`). It is listed under `preservedLocally` and remains on the ToonForge character record and provenance. It is not dropped from the project, and it is not pretended to exist inside the upstream artifact.

`required_actions` defaults to `idle`, `blink`, `look`, and `gesture` because ToonForge characters do not store an action list. That derivation is recorded on the mapping.

## Artifacts and validation

The runner may write only under the project workspace `<data>/projects/<id>/openmontage/`. A path outside that directory is rejected. After a zero exit, ToonForge still requires a non-empty video inside the workspace, copies it to `out/video.mp4`, and runs ffprobe. Text files and empty files fail. The sidecar kind is `openmontage`, which is a production media kind for the video. Narration, music, and the thumbnail still come from the existing engines and are marked `ffmpeg_dev`. `ffmpeg_dev` is accepted only when the selected pipeline is `offline_fixture`. An OpenMontage daily run therefore fails QA and does not publish until those assets are production media. That failure is recorded on the workflow; it is not replaced with the offline fixture.

Rendered preview length is capped at 8 seconds. The storyboard timeline keeps the full scene timing in `action_timeline.json`. This cap is the local Playwright preview contract, not a switch to another backend.

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
