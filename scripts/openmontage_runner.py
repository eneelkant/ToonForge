#!/usr/bin/env python3
"""Call a separately installed OpenMontage checkout.

ToonForge is Apache-2.0 and does not vendor OpenMontage (GNU AGPL-3.0).
This runner only adds the configured checkout to sys.path and calls the
published character-animation tool classes. It does not copy those tools.

Protocol: one JSON object on stdin, one JSON object on stdout.
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path
from typing import Any


def emit(payload: dict[str, Any], code: int = 0) -> None:
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    raise SystemExit(code)


def fail(error_class: str, message: str, code: int = 1) -> None:
    emit({"ok": False, "error_class": error_class, "message": message[:2000]}, code)


def read_request() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        fail("invalid_configuration", "runner expected a JSON request on stdin")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        fail("invalid_configuration", f"request is not JSON: {exc}")
    if not isinstance(data, dict):
        fail("invalid_configuration", "request must be a JSON object")
    return data


def resolve_dir(label: str, value: object) -> Path:
    if not isinstance(value, str) or not value.strip():
        fail("invalid_configuration", f"{label} is required")
    path = Path(value)
    if not path.is_absolute():
        fail("invalid_configuration", f"{label} must be an absolute path")
    return path


def contained(root: Path, candidate: Path) -> Path:
    root_real = root.resolve()
    candidate_real = candidate.resolve()
    if candidate_real != root_real and root_real not in candidate_real.parents:
        fail("path_traversal", f"refusing path outside workspace: {candidate}")
    return candidate_real


def load_tools(root: Path):
    root_real = root.resolve()
    if not root_real.is_dir():
        fail("not_installed", f"OPENMONTAGE_ROOT is not a directory: {root_real}")
    marker = root_real / "tools" / "character" / "character_animation.py"
    if not marker.is_file():
        fail("not_installed", "OpenMontage character_animation.py was not found in OPENMONTAGE_ROOT")
    sys.path.insert(0, str(root_real))
    try:
        from tools.character.character_animation import (  # type: ignore
            ActionTimelineCompiler,
            CharacterRigRenderer,
            CharacterSpecGenerator,
            PoseLibraryBuilder,
            SvgRigBuilder,
        )
    except ModuleNotFoundError as exc:
        fail("missing_dependencies", f"OpenMontage import failed: {exc}")
    except Exception as exc:  # noqa: BLE001 — surface install/runtime problems to the adapter
        fail("health_check_failed", f"OpenMontage import failed: {exc}")
    return {
        "character_spec_generator": CharacterSpecGenerator,
        "svg_rig_builder": SvgRigBuilder,
        "pose_library_builder": PoseLibraryBuilder,
        "action_timeline_compiler": ActionTimelineCompiler,
        "character_rig_renderer": CharacterRigRenderer,
    }


def versions_of(tools: dict[str, Any]) -> dict[str, str]:
    found: dict[str, str] = {}
    for name, cls in tools.items():
        value = getattr(cls, "version", None)
        if value:
            found[name] = str(value)
    return found


def tool_data(result: Any) -> dict[str, Any]:
    if not getattr(result, "success", False):
        fail("execution_failure", getattr(result, "error", None) or "OpenMontage tool returned success=false")
    data = getattr(result, "data", None)
    return data if isinstance(data, dict) else {}


def render(request: dict[str, Any], tools: dict[str, Any]) -> None:
    workspace = contained(resolve_dir("workspace", request.get("workspace")), resolve_dir("workspace", request.get("workspace")))
    workspace.mkdir(parents=True, exist_ok=True)
    video_path = contained(workspace, resolve_dir("video_output_path", request.get("video_output_path")))
    preview_path = contained(workspace, workspace / "preview.html")
    hyperframes = contained(workspace, workspace / "hyperframes")

    characters = request.get("characters")
    scene_plan = request.get("scene_plan")
    if not isinstance(characters, list) or not characters:
        fail("compatibility", "characters must be a non-empty array")
    if not isinstance(scene_plan, dict) or not isinstance(scene_plan.get("scenes"), list) or not scene_plan["scenes"]:
        fail("compatibility", "scene_plan.scenes must be a non-empty array")

    expected_ids = []
    for character in characters:
        if not isinstance(character, dict) or not character.get("id") or not character.get("display_name"):
            fail("compatibility", "each character needs id and display_name")
        expected_ids.append(str(character["id"]))

    design_path = contained(workspace, workspace / "character_design.json")
    rig_path = contained(workspace, workspace / "rig_plan.json")
    pose_path = contained(workspace, workspace / "pose_library.json")
    timeline_path = contained(workspace, workspace / "action_timeline.json")

    style = request.get("style") if isinstance(request.get("style"), dict) else {}
    design = tool_data(
        tools["character_spec_generator"]().execute(
            {
                "characters": characters,
                "brief": str(request.get("brief") or ""),
                "style": style,
                "output_path": str(design_path),
            }
        )
    ).get("character_design")
    if not isinstance(design, dict):
        fail("invalid_output", "character_spec_generator did not return character_design")
    returned_ids = [
        str(item.get("id"))
        for item in design.get("characters", [])
        if isinstance(item, dict) and item.get("id")
    ]
    missing = [cid for cid in expected_ids if cid not in returned_ids]
    if missing:
        fail("compatibility", "OpenMontage rewrote or dropped character ids: " + ", ".join(missing))

    rig = tool_data(
        tools["svg_rig_builder"]().execute({"character_design": design, "output_path": str(rig_path)})
    ).get("rig_plan")
    if not isinstance(rig, dict):
        fail("invalid_output", "svg_rig_builder did not return rig_plan")

    poses = tool_data(
        tools["pose_library_builder"]().execute({"rig_plan": rig, "output_path": str(pose_path)})
    ).get("pose_library")
    if not isinstance(poses, dict):
        fail("invalid_output", "pose_library_builder did not return pose_library")

    fps = int(request.get("fps") or 12)
    timeline = tool_data(
        tools["action_timeline_compiler"]().execute(
            {
                "scene_plan": scene_plan,
                "character_ids": expected_ids,
                "fps": fps,
                "output_path": str(timeline_path),
            }
        )
    ).get("action_timeline")
    if not isinstance(timeline, dict):
        fail("invalid_output", "action_timeline_compiler did not return action_timeline")

    rendered = tool_data(
        tools["character_rig_renderer"]().execute(
            {
                "action_timeline": timeline,
                "rig_plan": rig,
                "pose_library": poses,
                "output_path": str(preview_path),
                "workspace_path": str(hyperframes),
                "video_output_path": str(video_path),
                "render_video": True,
                "duration_seconds": float(request.get("duration_seconds") or 3),
                "fps": fps,
            }
        )
    )
    reported = rendered.get("video_path")
    if not isinstance(reported, str) or not reported:
        fail("invalid_output", "character_rig_renderer did not return video_path")
    reported_path = contained(workspace, Path(reported))
    if not reported_path.is_file() or reported_path.stat().st_size <= 0:
        fail("invalid_output", f"rendered video missing or empty: {reported_path}")

    emit(
        {
            "ok": True,
            "versions": versions_of(tools),
            "video_path": str(reported_path),
            "preview_path": str(preview_path),
            "character_ids": returned_ids,
            "display_names": [
                str(item.get("display_name"))
                for item in design.get("characters", [])
                if isinstance(item, dict) and item.get("display_name")
            ],
            "artifacts": [
                str(design_path),
                str(rig_path),
                str(pose_path),
                str(timeline_path),
                str(preview_path),
                str(reported_path),
            ],
            "cost_usd": 0,
            "approval": {
                "agent_pipeline": "not_invoked",
                "detail": "Deterministic tool execute() only. Agent checkpoint approvals were not simulated.",
            },
        }
    )


def main() -> None:
    request = read_request()
    operation = request.get("operation")
    root = resolve_dir("root", request.get("root"))
    if operation == "probe":
        tools = load_tools(root)
        emit({"ok": True, "versions": versions_of(tools), "root": str(root.resolve())})
    if operation == "render":
        # Reject escaped outputs before importing the AGPL tree when possible.
        workspace = resolve_dir("workspace", request.get("workspace"))
        video = resolve_dir("video_output_path", request.get("video_output_path"))
        contained(workspace, video)
        tools = load_tools(root)
        render(request, tools)
    fail("invalid_configuration", f"unsupported operation: {operation}")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc(file=sys.stderr)
        fail("execution_failure", str(exc))
