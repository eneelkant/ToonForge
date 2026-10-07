import { describe, expect, it } from "vitest";
import { ManualSeedTrendProvider, scoreTrend, selectOpportunity, dedupeTrends } from "../../src/engines/trend/index.js";
import { generateOriginalStory, validateStory } from "../../src/engines/story/index.js";
import { createStoryboard, regenerateShot } from "../../src/engines/storyboard/index.js";
import { runQa } from "../../src/engines/qa/index.js";
import { FileCharacterRegistry } from "../../src/characters/registry.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("engines basics", () => {
  it("scores and selects trends", async () => {
    const provider = new ManualSeedTrendProvider();
    const trends = dedupeTrends(await provider.discover({ niche: "kids cartoon", limit: 3 }));
    expect(trends.length).toBeGreaterThan(0);
    expect(scoreTrend({
      velocity: 0.8,
      engagement: 0.7,
      freshness: 0.9,
      nicheFit: 0.9,
      originality: 0.8,
      saturation: 0.2,
      policyRisk: 0.1,
    })).toBeGreaterThan(0.5);
    expect(selectOpportunity(trends)?.status).toBe("candidate");
  });

  it("generates and validates an original story", async () => {
    const chars = await new FileCharacterRegistry("characters").list();
    const story = generateOriginalStory({ characters: chars.slice(0, 2), durationTarget: 40 });
    expect(validateStory(story).ok).toBe(true);
    const board = createStoryboard(story);
    expect(board.shots.length).toBe(story.scenes.length);
    const updated = regenerateShot(board, board.shots[0]!.shot_id, { visual: "new framing" });
    expect(updated.shots[0]!.visual).toBe("new framing");
  });

  it("QA fails without artifacts", () => {
    const report = runQa({ storyComplete: true, originalContent: true, thirdPartyFootage: false });
    expect(report.verdict).toBe("FAIL");
  });

  it("QA passes with files in dry stub mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-qa-"));
    const video = join(dir, "v.mp4");
    const cap = join(dir, "c.vtt");
    const thumb = join(dir, "t.jpg");
    writeFileSync(video, "TOONFORGE_LOCAL_RENDER");
    writeFileSync(cap, "WEBVTT");
    writeFileSync(thumb, "x");
    const report = runQa({
      videoPath: video,
      captionsPath: cap,
      thumbnailPath: thumb,
      metadata: { title: "t", description: "d" },
      storyComplete: true,
      originalContent: true,
      thirdPartyFootage: false,
      allowStubVideo: true,
    });
    expect(["PASS", "WARN"]).toContain(report.verdict);
  });
});
