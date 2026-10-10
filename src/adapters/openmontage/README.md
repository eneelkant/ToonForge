# OpenMontage adapter

OpenMontage is an optional, separately installed production backend. ToonForge does not vendor its AGPL-3.0 source.

## What this calls

Inspected upstream commit `9327439db69021ab4b0e2776729bf3b58fdb5a87` on https://github.com/calesthio/OpenMontage.

There is no production REST API. The supported programmatic interface used here is the character-animation `BaseTool.execute()` classes:

- `character_spec_generator`
- `svg_rig_builder`
- `pose_library_builder`
- `action_timeline_compiler`
- `character_rig_renderer` with `render_video: true`

`scripts/openmontage_runner.py` launches the configured Python against `OPENMONTAGE_ROOT` and passes a JSON request on stdin. Arguments are an argv array. User input is never interpolated into a shell.

Reference downloaders (`video_downloader` and the rest of the analysis tool list) are not called. ReelMimic, or the offline format fixture, still owns reference analysis.

`video_compose` (Remotion, HyperFrames, FFmpeg encode/burn) is not selected as a fallback. If `character_rig_renderer` fails, the job fails.

## Approval

`pipeline_defs/character-animation.yaml` sets `human_approval_default: true` on proposal, script, character design, scene plan, assets, and publish. Those gates belong to the agent checkpoint workflow. This adapter does not run that workflow and does not write fake approvals. The render result records `approval.agentPipeline = not_invoked`.

Local character tools themselves do not gate on approval. Their documented cost for this path is `$0` (`total_cost_usd: 0` on the generated manifest). Paid TTS, music, and video providers are not invoked.

## Output

Artifacts stay under the project workspace (`<project>/openmontage/`), including `video.mp4`. ToonForge copies a validated file to `<project>/out/video.mp4` and marks it `kind=openmontage`. A successful process exit with a missing or invalid file is a failure.
