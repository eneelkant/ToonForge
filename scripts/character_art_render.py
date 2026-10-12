#!/usr/bin/env python3
"""Rasterize original ToonForge character-art frames and encode an MP4.

This script is Apache-2.0 ToonForge code. It does not import OpenMontage and
does not draw the schematic rig. Playwright and ffmpeg are optional runtime
tools: if either is missing, the process fails with missing_dependencies.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


def emit(payload: dict[str, Any], code: int = 0) -> None:
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    raise SystemExit(code)


def fail(error_class: str, message: str, code: int = 1) -> None:
    emit({"ok": False, "error_class": error_class, "message": message[:2000]}, code)


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        fail("invalid_configuration", "character art renderer expected JSON on stdin")
    try:
        request = json.loads(raw)
    except json.JSONDecodeError as exc:
        fail("invalid_configuration", f"request is not JSON: {exc}")
    if not isinstance(request, dict):
        fail("invalid_configuration", "request must be a JSON object")

    frames_value = request.get("frames_dir")
    video_value = request.get("video_output_path")
    if not isinstance(frames_value, str) or not isinstance(video_value, str):
        fail("invalid_configuration", "frames_dir and video_output_path are required")
    frames_dir = Path(frames_value)
    video = Path(video_value)
    still_value = request.get("still_path")
    still = Path(still_value) if isinstance(still_value, str) and still_value else video.with_name("character-still.png")
    fps = int(request.get("fps") or 12)
    if fps < 1:
        fail("invalid_configuration", "fps must be positive")
    svgs = sorted(frames_dir.glob("frame_*.svg"))
    if not svgs:
        fail("invalid_output", f"no character-art SVG frames in {frames_dir}")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        fail(
            "missing_dependencies",
            "Playwright is required to render character art. "
            "Install it in the OpenMontage Python environment: "
            "pip install playwright && python -m playwright install chromium",
        )

    png_dir = frames_dir / "png"
    png_dir.mkdir(parents=True, exist_ok=True)
    video.parent.mkdir(parents=True, exist_ok=True)
    still.parent.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            for index, svg_path in enumerate(svgs):
                svg = svg_path.read_text(encoding="utf-8")
                html = (
                    "<!doctype html><html><head><meta charset='utf-8'></head>"
                    "<body style='margin:0;width:1280px;height:720px;overflow:hidden;background:#f6e2c4'>"
                    f"{svg}</body></html>"
                )
                page.set_content(html, wait_until="load")
                page.screenshot(
                    path=str(png_dir / f"frame_{index:05d}.png"),
                    clip={"x": 0, "y": 0, "width": 1280, "height": 720},
                )
            browser.close()
    except Exception as exc:  # noqa: BLE001 — surface missing browsers as a setup error
        text = str(exc)
        if "Executable doesn't exist" in text or "playwright" in text.lower() or "browserType.launch" in text:
            fail(
                "missing_dependencies",
                "Playwright could not launch Chromium for character art. "
                f"Run python -m playwright install chromium. Detail: {text}",
            )
        fail("execution_failure", f"character art frame capture failed: {text}")

    mid = png_dir / f"frame_{(len(svgs) // 2):05d}.png"
    shutil.copyfile(mid, still)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        fail("missing_dependencies", "ffmpeg is required to encode character art frames")
    encoded = subprocess.run(
        [
            ffmpeg,
            "-y",
            "-framerate",
            str(fps),
            "-i",
            str(png_dir / "frame_%05d.png"),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(video),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if encoded.returncode != 0 or not video.is_file() or video.stat().st_size <= 0:
        tail = (encoded.stderr or "")[-800:]
        fail("execution_failure", f"ffmpeg failed to encode character art: {tail}")
    emit(
        {
            "ok": True,
            "video_path": str(video),
            "still_path": str(still),
            "frames": len(svgs),
        }
    )


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        fail("execution_failure", str(exc))
