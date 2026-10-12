import { describe, expect, it } from "vitest";
import { ManualSeedTrendProvider, scoreTrend, selectOpportunity, dedupeTrends } from "../../src/engines/trend/index.js";
import { generateOriginalStory, validateStory } from "../../src/engines/story/index.js";
import { createStoryboard, regenerateShot } from "../../src/engines/storyboard/index.js";
import { runQa } from "../../src/engines/qa/index.js";
import { FileCharacterRegistry } from "../../src/characters/registry.js";
import { generateDevThumbnail, generateDevVideo, writeMediaSidecar } from "../../src/core/media.js";
import { buildContentPackage } from "../../src/engines/packaging/index.js";
import { parseDailyRunArgs } from "../../src/cli/daily-args.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  it("QA fails without artifacts", async () => {
    const report = await runQa({ storyComplete: true, originalContent: true, thirdPartyFootage: false });
    expect(report.verdict).toBe("FAIL");
  });

  it("QA fails text-placeholder stub videos even in dry-run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-qa-"));
    const video = join(dir, "v.mp4");
    const cap = join(dir, "c.vtt");
    const thumb = join(dir, "t.jpg");
    writeFileSync(video, "TOONFORGE_LOCAL_RENDER");
    writeFileSync(cap, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhi\n");
    writeFileSync(thumb, "THUMB:x");
    const report = await runQa({
      videoPath: video,
      captionsPath: cap,
      thumbnailPath: thumb,
      metadata: { title: "t", description: "d" },
      storyComplete: true,
      originalContent: true,
      thirdPartyFootage: false,
      allowDevFixtures: true,
    });
    expect(report.verdict).toBe("FAIL");
    expect(report.checks.some((c) => c.id === "media.video" && c.verdict === "FAIL")).toBe(true);
  });

  it("QA passes with real FFmpeg fixtures in dry-run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-qa-real-"));
    const video = join(dir, "v.mp4");
    const cap = join(dir, "c.vtt");
    const thumb = join(dir, "t.jpg");
    await generateDevVideo({ outPath: video, durationSec: 1, withAudio: true });
    writeMediaSidecar(video, { kind: "ffmpeg_dev" });
    await generateDevThumbnail({ outPath: thumb });
    writeMediaSidecar(thumb, { kind: "ffmpeg_dev" });
    writeFileSync(cap, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhi\n");
    const report = await runQa({
      videoPath: video,
      captionsPath: cap,
      thumbnailPath: thumb,
      metadata: { title: "t", description: "d" },
      storyComplete: true,
      originalContent: true,
      thirdPartyFootage: false,
      allowDevFixtures: true,
    });
    expect(report.verdict).toBe("PASS");
  }, 60_000);

  it("uses an operator concept as original scene beats", async () => {
    const chars = await new FileCharacterRegistry("characters").list();
    const story = generateOriginalStory({
      characters: chars.filter((c) => c.character_id === "max"),
      durationTarget: 6,
      episodeConcept: "Max discovers a glowing seed. The seed sprouts into a tiny floating garden. Max reacts with wonder.",
    });
    expect(validateStory(story).ok).toBe(true);
    expect(story.scenes.map((scene) => scene.narration)).toEqual([
      "Max discovers a glowing seed.",
      "The seed sprouts into a tiny floating garden.",
      "Max reacts with wonder.",
    ]);
    expect(story.narration).not.toMatch(/We can fix this/);
    expect(story.scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0)).toBe(6);
  });

  it("extracts a production thumbnail from the source video and leaves the dev card labeled ffmpeg_dev", async () => {
    const chars = await new FileCharacterRegistry("characters").list();
    const story = generateOriginalStory({ characters: chars.slice(0, 1), durationTarget: 6 });
    const dir = mkdtempSync(join(tmpdir(), "tf-thumb-"));
    const video = join(dir, "video.mp4");
    await generateDevVideo({ outPath: video, durationSec: 1, withAudio: false, width: 640, height: 360 });
    writeMediaSidecar(video, { kind: "openmontage", provider: "openmontage" });
    const pack = await buildContentPackage({
      projectDir: dir,
      story,
      durationSeconds: 6,
      sourceVideo: { path: video, kind: "openmontage" },
    });
    expect(pack.thumbnailKind).toBe("openmontage");
    const meta = JSON.parse(readFileSync(`${pack.thumbnailPath}.meta.json`, "utf8")) as { kind: string };
    expect(meta.kind).toBe("openmontage");
    expect(parseDailyRunArgs(["--pipeline", "openmontage", "--channel-config", "channel.yaml"]).pipelineMode).toBe("openmontage");
    expect(() => parseDailyRunArgs(["--pipeline", "fixture"])).toThrow(/pipeline/);
  }, 30_000);
});
