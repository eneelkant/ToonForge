import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectInvalidStub,
  generateDevAudio,
  generateDevThumbnail,
  generateDevVideo,
  mixAudioTracks,
  muxVideoAudio,
  validateAudio,
  validateImage,
  validateVideo,
  writeMediaSidecar,
  readMediaKind,
} from "../../src/core/media.js";

describe("media validation + ffmpeg fixtures", () => {
  it("rejects text placeholder as invalid stub", () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-stub-"));
    const path = join(dir, "fake.mp4");
    writeFileSync(path, "TOONFORGE_LOCAL_RENDER\nstub\n");
    expect(detectInvalidStub(path)).toBe(true);
  });

  it("generates and validates real video/audio/thumbnail", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-media-"));
    const video = join(dir, "v.mp4");
    const voice = join(dir, "voice.m4a");
    const music = join(dir, "music.m4a");
    const mix = join(dir, "mix.m4a");
    const final = join(dir, "final.mp4");
    const thumb = join(dir, "t.jpg");

    await generateDevVideo({ outPath: video, durationSec: 1, withAudio: true });
    writeMediaSidecar(video, { kind: "ffmpeg_dev" });
    expect(readMediaKind(video)).toBe("ffmpeg_dev");

    const vv = await validateVideo(video, { requireAudio: true, minDurationSec: 0.5 });
    expect(vv.ok).toBe(true);
    expect(vv.hasVideo).toBe(true);
    expect(vv.hasAudio).toBe(true);

    await generateDevAudio({ outPath: voice, durationSec: 1, frequencyHz: 440 });
    await generateDevAudio({ outPath: music, durationSec: 1, frequencyHz: 220 });
    await mixAudioTracks({ voicePath: voice, musicPath: music, outPath: mix });
    expect((await validateAudio(mix)).ok).toBe(true);

    await muxVideoAudio({ videoPath: video, audioPath: mix, outPath: final });
    expect((await validateVideo(final, { requireAudio: true })).ok).toBe(true);

    await generateDevThumbnail({ outPath: thumb, width: 1280, height: 720 });
    const img = await validateImage(thumb, { minWidth: 640, minHeight: 360, expectedAspect: 16 / 9 });
    expect(img.ok).toBe(true);
  }, 90_000);
});
