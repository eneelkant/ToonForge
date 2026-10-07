import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildOfflineFormatAnalysis,
  resolvePipelineMode,
  resolveReference,
  toStoryFormatHints,
} from "../../src/engines/reference/index.js";
import { ManualSeedTrendProvider } from "../../src/engines/trend/index.js";
import { ToonForgeError } from "../../src/core/errors.js";
import { produceCartoon } from "../../src/engines/production/index.js";
import { generateOriginalStory } from "../../src/engines/story/index.js";
import { createStoryboard } from "../../src/engines/storyboard/index.js";
import { FileCharacterRegistry } from "../../src/characters/registry.js";
import { generateDevVideo } from "../../src/core/media.js";

describe("reference resolution + pipeline mode", () => {
  it("uses offline_fixture when ReelMimic disabled", () => {
    expect(resolvePipelineMode({ reelmimicEnabled: false })).toBe("offline_fixture");
  });

  it("uses reelmimic when enabled even if dry-run would have preferred fixtures historically", () => {
    expect(resolvePipelineMode({ reelmimicEnabled: true })).toBe("reelmimic");
    expect(
      resolvePipelineMode({ reelmimicEnabled: true, preferOfflineFixture: true }),
    ).toBe("reelmimic");
  });

  it("offline mode never invents a .txt video reference for ReelMimic", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-ref-"));
    const [trend] = await new ManualSeedTrendProvider().discover({ niche: "kids", limit: 1 });
    const resolved = resolveReference({ mode: "offline_fixture", trend: trend!, projectDir: dir });
    expect(resolved.designation).toBe("offline_fixture");
    expect(resolved.referencePath).toBeUndefined();
    expect(resolved.referenceUrl).toBeUndefined();
    expect(resolved.offlineFormatReport).toBeTruthy();
    expect(resolved.notes.some((n) => n.includes("OFFLINE FIXTURE"))).toBe(true);
    expect(resolved.notes.every((n) => !n.includes("synthetic-reference.txt"))).toBe(true);
  });

  it("reelmimic mode fails without a real video reference", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-ref-fail-"));
    const [trend] = await new ManualSeedTrendProvider().discover({ niche: "kids", limit: 1 });
    expect(() =>
      resolveReference({ mode: "reelmimic", trend: trend!, projectDir: dir }),
    ).toThrow(ToonForgeError);
  });

  it("rejects .txt as referencePath", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-ref-txt-"));
    const txt = join(dir, "synthetic-reference.txt");
    writeFileSync(txt, "not a video");
    const [trend] = await new ManualSeedTrendProvider().discover({ niche: "kids", limit: 1 });
    expect(() =>
      resolveReference({
        mode: "reelmimic",
        trend: trend!,
        projectDir: dir,
        referencePathOverride: txt,
      }),
    ).toThrow(/video file/);
  });

  it("accepts a real local video path override", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-ref-vid-"));
    const video = join(dir, "ref.mp4");
    await generateDevVideo({ outPath: video, durationSec: 1, withAudio: true });
    const [trend] = await new ManualSeedTrendProvider().discover({ niche: "kids", limit: 1 });
    const resolved = resolveReference({
      mode: "reelmimic",
      trend: trend!,
      projectDir: dir,
      referencePathOverride: video,
    });
    expect(resolved.referencePath).toBe(video);
    expect(resolved.licenseStatus).toBe("unknown");
  }, 60_000);

  it("builds format hints distinct from original story dialogue", async () => {
    const [trend] = await new ManualSeedTrendProvider().discover({ niche: "kids", limit: 1 });
    const report = buildOfflineFormatAnalysis(trend!);
    const hints = toStoryFormatHints(report);
    expect(hints.analysis_only).toBe(true);
    expect(hints.scene_structure?.length).toBeGreaterThan(0);
    const chars = await new FileCharacterRegistry("characters").list();
    const story = generateOriginalStory({
      trend: trend!,
      characters: chars.slice(0, 2),
      formatHints: hints,
      durationTarget: 40,
    });
    expect(story.format_hints?.hook_pattern).toBeTruthy();
    expect(story.dialogue.join(" ").toLowerCase()).not.toContain("subscribe for more from the original channel");
  });

  it("does not silently fall back to ffmpeg when reelmimic mode fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-prod-"));
    const chars = await new FileCharacterRegistry("characters").list();
    const story = generateOriginalStory({ characters: chars.slice(0, 2), durationTarget: 30 });
    const storyboard = createStoryboard(story);
    const fakeAdapter = {
      name: "reelmimic" as const,
      client: null,
      probe: async () => ({ status: "ready" as const, detail: "mock" }),
      health: async () => ({ ok: true, baseUrl: "http://127.0.0.1:4318", detail: "mock" }),
      analyzeReference: async () => {
        throw new Error("unused");
      },
      getAnalysisReport: async () => {
        throw new Error("unused");
      },
      createProject: async () => {
        throw new Error("simulated ReelMimic failure");
      },
      getProject: async () => ({ id: "x", raw: {} }),
      approve: async () => undefined,
      resume: async () => undefined,
      retry: async () => undefined,
      cancel: async () => undefined,
      discoverArtifacts: async () => ({ projectId: "x", failed: true, detail: "failed" }),
    };

    await expect(
      produceCartoon({
        projectId: "p1",
        projectDir: dir,
        story,
        storyboard,
        reelmimic: fakeAdapter,
        mode: "reelmimic",
        referenceUrl: "https://example.com/ref.mp4",
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });
});
