import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { generateAudioBundle } from "../../src/engines/audio/index.js";
import { resolveProductionAudioConfig } from "../../src/engines/audio/production.js";
import { runQa } from "../../src/engines/qa/index.js";
import { generateDevAudio, writeMediaSidecar } from "../../src/core/media.js";
import type { OriginalStory } from "../../src/engines/story/index.js";

const execFileAsync = promisify(execFile);

const story = {
  narration: "Max discovers a glowing seed. The seed sprouts into a tiny floating garden.",
  title: "Max's Original Moment",
  logline: "An original short.",
  hook: "Max discovers a glowing seed.",
  synopsis: "Original.",
  characters: ["max"],
  scenes: [],
  dialogue: [],
  duration_target: 2,
  format: "shorts",
  originality_notes: [],
  risk_flags: [],
  version: "1.0.0",
  story_id: "story_test",
  script_hash: "abc",
} as OriginalStory;

const licensedConfig = {
  piperPython: "/usr/bin/python3",
  piperModel: "/tmp/voice.onnx",
  ttsLicense: "public-domain",
  ttsAttribution: "LJ Speech public-domain dataset, Piper MIT",
  ttsSourceUrl: "https://keithito.com/LJ-Speech-Dataset/",
  musicFile: "",
  musicLicense: "cc-by-3.0",
  musicTitle: "Carefree",
  musicAttribution: "Carefree by Kevin MacLeod (incompetech.com), CC BY 3.0",
  musicSourceUrl: "https://commons.wikimedia.org/wiki/File:Carefree_(ISRC_USUAN1400037).mp3",
};

async function writeWav(path: string, seconds: number): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=${seconds}`,
    "-ar",
    "22050",
    path,
  ]);
}

describe("production audio", () => {
  it("refuses an open production run when Piper or licensed music is missing", () => {
    expect(() => resolveProductionAudioConfig({})).toThrow(/TOONFORGE_PIPER_MODEL/);
    expect(() => resolveProductionAudioConfig({})).toThrow(/Lessac/);
    expect(() =>
      resolveProductionAudioConfig({
        TOONFORGE_TTS_PROVIDER: "piper",
        TOONFORGE_PIPER_PYTHON: "/usr/bin/python3",
        TOONFORGE_PIPER_MODEL: "/tmp/voice.onnx",
        TOONFORGE_TTS_LICENSE: "cc-by-nc-sa-4.0",
        TOONFORGE_TTS_ATTRIBUTION: "no",
        TOONFORGE_TTS_SOURCE_URL: "https://example.com/voice",
        TOONFORGE_MUSIC_FILE: "/tmp/music.mp3",
        TOONFORGE_MUSIC_LICENSE: "cc-by-nc-4.0",
        TOONFORGE_MUSIC_TITLE: "Nope",
        TOONFORGE_MUSIC_ATTRIBUTION: "no",
        TOONFORGE_MUSIC_SOURCE_URL: "https://example.com/music",
      }),
    ).toThrow(/TOONFORGE_TTS_LICENSE/);
  });

  it("does not fall back to a development tone when the synthesizer fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-audio-fail-"));
    const music = join(dir, "source.m4a");
    await generateDevAudio({ outPath: music, durationSec: 2 });
    await expect(
      generateAudioBundle({
        projectDir: dir,
        story,
        mode: "production",
        targetDurationSec: 2,
        productionConfig: { ...licensedConfig, musicFile: music },
        synthesizeWav: async () => {
          throw new Error("piper down");
        },
      }),
    ).rejects.toThrow(/Piper narration failed/);
    expect(existsSync(join(dir, "audio", "mix.m4a.meta.json"))).toBe(false);
  });

  it("mixes a configured voice and a licensed bed without labeling them ffmpeg_dev", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-audio-ok-"));
    const music = join(dir, "source.m4a");
    await generateDevAudio({ outPath: music, durationSec: 3, frequencyHz: 110 });
    const bundle = await generateAudioBundle({
      projectDir: dir,
      story,
      mode: "production",
      targetDurationSec: 2,
      productionConfig: { ...licensedConfig, musicFile: music },
      synthesizeWav: async (_text, wavPath) => {
        await writeWav(wavPath, 1.5);
      },
    });
    expect(bundle.kind).toBe("provider");
    expect(bundle.narrationSha256).toBe(createHash("sha256").update(story.narration).digest("hex"));
    const meta = JSON.parse(readFileSync(`${bundle.mixPath}.meta.json`, "utf8")) as { kind: string; notes: string[] };
    expect(meta.kind).toBe("provider");
    expect(meta.notes.join(" ")).not.toMatch(/ffmpeg_dev|DEV\/CI/);
    const record = JSON.parse(readFileSync(join(dir, "audio", "audio.json"), "utf8")) as { narration: string };
    expect(record.narration).toBe(story.narration);
    expect(bundle.credits).toMatch(/cc-by-3.0/);
    expect(bundle.licenses?.map((item) => item.license).sort()).toEqual(["cc-by-3.0", "public-domain"]);
  }, 30_000);

  it("still blocks a development-tone mix in QA", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-audio-qa-"));
    const mix = join(dir, "mix.m4a");
    await generateDevAudio({ outPath: mix, durationSec: 1 });
    writeMediaSidecar(mix, { kind: "ffmpeg_dev", notes: ["DEV/CI ONLY"] });
    const qa = await runQa({
      audioPath: mix,
      storyComplete: true,
      originalContent: true,
      thirdPartyFootage: false,
      allowDevFixtures: false,
      metadata: { title: "t", description: "d" },
    });
    expect(qa.verdict).toBe("FAIL");
    expect(qa.checks.some((check) => check.id === "media.audio" && check.verdict === "FAIL")).toBe(true);
  });
});
