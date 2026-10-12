import { execFile } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenMontageAdapter } from "../../src/adapters/openmontage/types.js";
import { defaultCharacterRegistry } from "../../src/characters/registry.js";
import type { CharacterRecord } from "../../src/characters/types.js";
import {
  buildCharacterFrames,
  identityFromCharacter,
  inspectCharacterArtSvg,
  poseState,
  renderCharacterSvg,
} from "../../src/engines/character-art/index.js";
import { renderCharacterArt } from "../../src/engines/character-art/render.js";
import { produceCartoon } from "../../src/engines/production/index.js";
import {
  PREVIEW_DURATION_MAX_SEC,
  PRODUCTION_DURATION_MAX_SEC,
  resolveRenderDuration,
  storyboardDurationSec,
} from "../../src/engines/production/duration.js";
import { generateOriginalStory } from "../../src/engines/story/index.js";
import { createStoryboard } from "../../src/engines/storyboard/index.js";

async function maxRecord(): Promise<CharacterRecord> {
  const max = (await defaultCharacterRegistry().list()).find((character) => character.character_id === "max");
  if (!max) throw new Error("max is missing from the character registry");
  return max;
}

function storyFor(max: CharacterRecord, duration = 18) {
  return generateOriginalStory({
    characters: [max],
    durationTarget: duration,
    episodeConcept:
      "Max finds a glowing gear under the bench. Max fits the gear into a tiny engine. Max reacts with wonder.",
  });
}

describe("character art identity", () => {
  it("draws Max from the registry and rejects a different design", async () => {
    const max = await maxRecord();
    const identity = identityFromCharacter(max);
    expect(identity.id).toBe("max");
    expect(identity.displayName).toBe("Max");
    expect(identity.goggles).toBe(true);
    expect(identity.hoodie).toBe("#2f6fed");
    expect(identity.hair).toBe("#8d3b2a");

    const idle = renderCharacterSvg(identity, poseState("idle", 10, 12));
    const wonder = renderCharacterSvg(identity, poseState("wonder", 10, 12));
    expect(inspectCharacterArtSvg(idle, identity)).toEqual({ ok: true, characterId: "max", findings: [] });
    expect(inspectCharacterArtSvg(wonder, identity).ok).toBe(true);
    expect(wonder).not.toBe(idle);
    expect(wonder).toContain('data-pose="wonder"');
    expect(wonder).toContain('id="story-prop"');
    expect(idle).not.toContain('id="story-prop"');
    expect(wonder).not.toContain('cy="230" r="90"');

    expect(() =>
      identityFromCharacter({
        ...max,
        canonical_description: "A red robot with a single visor.",
        wardrobe: ["metal"],
      }),
    ).toThrow(/locked visual tokens/);
  });

  it("keeps Max's identity across shots and refuses an undrawable cast member", async () => {
    const characters = await defaultCharacterRegistry().list();
    const max = characters.find((character) => character.character_id === "max");
    const bolt = characters.find((character) => character.character_id === "bolt");
    if (!max || !bolt) throw new Error("registry missing max or bolt");
    const story = storyFor(max, 18);
    const board = createStoryboard(story);
    expect(storyboardDurationSec(board)).toBe(18);
    const frames = buildCharacterFrames({
      characters: [max],
      storyboard: board,
      durationSec: 18,
      fps: 12,
    });
    expect(frames).toHaveLength(18 * 12);
    const poses = new Set(frames.map((frame) => frame.pose));
    expect(poses.size).toBeGreaterThan(1);
    for (const frame of [frames[0], frames[Math.floor(frames.length / 2)], frames[frames.length - 1]]) {
      if (!frame) throw new Error("missing frame");
      const inspection = inspectCharacterArtSvg(frame.svg, identityFromCharacter(max));
      expect(inspection.ok).toBe(true);
      expect(frame.characterId).toBe("max");
      expect(frame.svg).toContain('data-display-name="Max"');
      expect(frame.svg).toContain('fill="#2f6fed"');
      expect(frame.svg).toContain('fill="#8d3b2a"');
    }
    const mixed = createStoryboard(story);
    const first = mixed.shots[0];
    if (!first) throw new Error("missing shot");
    first.characters = ["max", "bolt"];
    expect(() =>
      buildCharacterFrames({
        characters: [max, bolt],
        storyboard: mixed,
        durationSec: 2,
        fps: 1,
      }),
    ).toThrow(/bolt/);
  });
});

describe("preview and production duration", () => {
  it("caps previews at 8 seconds and uses the storyboard for production", () => {
    expect(PREVIEW_DURATION_MAX_SEC).toBe(8);
    expect(resolveRenderDuration({ requestedSec: 45, storyboardSec: 45, preview: true })).toBe(8);
    expect(resolveRenderDuration({ storyboardSec: 1, preview: true })).toBe(2);
    expect(resolveRenderDuration({ requestedSec: 45, storyboardSec: 18 })).toBe(18);
    expect(resolveRenderDuration({ storyboardSec: 45 })).toBe(45);
    expect(() => resolveRenderDuration({ storyboardSec: PRODUCTION_DURATION_MAX_SEC + 1 })).toThrow(/120/);
    expect(() => resolveRenderDuration({ storyboardSec: 1 })).toThrow(/at least 2/);
  });
});

describe("character art renderer dependencies", () => {
  it("fails closed when Playwright is missing and does not publish a video", async () => {
    const max = await maxRecord();
    const story = storyFor(max, 6);
    const board = createStoryboard(story);
    const projectDir = mkdtempSync(join(tmpdir(), "tf-art-missing-"));
    let renderVideo: boolean | undefined;
    const openmontage: OpenMontageAdapter = {
      name: "openmontage",
      async probe() {
        return { status: "ready" };
      },
      async health() {
        return { status: "ready", detail: "test double" };
      },
      async renderCharacterAnimation(input) {
        renderVideo = input.renderVideo;
        expect(input.durationSeconds).toBe(6);
        return {
          artifactPaths: [],
          versions: { character_spec_generator: "0.1.0" },
          characterIds: [max.character_id],
          displayNames: [max.display_name],
          durationMs: 1,
          retryCount: 0,
          estimatedCostUsd: 0,
          actualCostUsd: 0,
          approval: { agentPipeline: "not_invoked", detail: "test double" },
        };
      },
    };
    await expect(
      produceCartoon({
        projectId: "art-missing",
        projectDir,
        story,
        storyboard: board,
        characters: [max],
        openmontage,
        mode: "openmontage",
        durationSec: 45,
        characterArtRun: async () => ({
          code: 1,
          stdout: JSON.stringify({
            ok: false,
            error_class: "missing_dependencies",
            message:
              "Playwright is required to render character art. Install it in the OpenMontage Python environment: pip install playwright && python -m playwright install chromium",
          }),
          stderr: "",
          timedOut: false,
        }),
      }),
    ).rejects.toThrow(/Playwright is required/);
    expect(renderVideo).toBe(false);
    expect(existsSync(join(projectDir, "out", "video.mp4"))).toBe(false);
    expect(existsSync(join(projectDir, "out", "video.mp4.meta.json"))).toBe(false);
  });

  it("the render script reports a missing Playwright install instead of writing a video", async () => {
    const probe = await new Promise<number>((done) => {
      execFile("python3", ["-c", "import playwright"], (error) => {
        done(error ? 1 : 0);
      });
    });
    if (probe === 0) return;
    const dir = mkdtempSync(join(tmpdir(), "tf-art-script-"));
    const frames = join(dir, "frames");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(frames);
    writeFileSync(join(frames, "frame_00000.svg"), "<svg xmlns='http://www.w3.org/2000/svg' width='1280' height='720'></svg>");
    const video = join(dir, "video.mp4");
    const { stdout, code } = await new Promise<{ stdout: string; code: number }>((done) => {
      const child = execFile("python3", [resolve("scripts/character_art_render.py")], { timeout: 20_000 }, (error, out) => {
        const exit = typeof error?.code === "number" ? error.code : error ? 1 : 0;
        done({ stdout: String(out ?? ""), code: exit });
      });
      child.stdin?.end(JSON.stringify({ frames_dir: frames, video_output_path: video, fps: 12 }));
    });
    expect(code).not.toBe(0);
    const body = JSON.parse(stdout) as { error_class: string; message: string };
    expect(body.error_class).toBe("missing_dependencies");
    expect(body.message).toMatch(/Playwright/);
    expect(existsSync(video)).toBe(false);
    await expect(
      renderCharacterArt({
        characters: [await maxRecord()],
        storyboard: createStoryboard(storyFor(await maxRecord(), 6)),
        outPath: join(dir, "unused.mp4"),
        framesDir: join(dir, "unused-frames"),
        durationSec: 6,
        python: "python3",
        run: async () => ({
          code: 1,
          stdout,
          stderr: "",
          timedOut: false,
        }),
      }),
    ).rejects.toThrow(/Playwright/);
  });
});
