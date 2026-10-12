import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { OriginalStory } from "../story/index.js";
import {
  extractVideoFrame,
  generateDevThumbnail,
  isProductionMediaKind,
  validateImage,
  writeMediaSidecar,
  type MediaKind,
} from "../../core/media.js";
import { ToonForgeError } from "../../core/errors.js";

const execFileAsync = promisify(execFile);

export function formatTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const whole = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

/** Scene cues scaled onto the spoken timeline. The clock matches the fitted narration, not trailing silence. */
export function captionTrack(
  scenes: Array<{ narration: string; duration_seconds: number }>,
  timelineSec: number,
): { vtt: string; srt: string } {
  const planned = scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0);
  const scale = planned > 0 ? timelineSec / planned : 1;
  let cursor = 0;
  const cues: string[] = [];
  const srt: string[] = [];
  scenes.forEach((scene, index) => {
    const start = cursor;
    cursor += scene.duration_seconds * scale;
    const end = index === scenes.length - 1 ? timelineSec : cursor;
    const text = scene.narration.trim().replace(/\s+/g, " ");
    cues.push(`${formatTimestamp(start)} --> ${formatTimestamp(end)}\n${text}`);
    const srtTime = (value: number) => formatTimestamp(value).replace(".", ",");
    srt.push(`${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text}`);
  });
  return { vtt: `WEBVTT\n\n${cues.join("\n\n")}\n`, srt: `${srt.join("\n\n")}\n` };
}

export interface ContentPackage {
  captionsPath: string;
  thumbnailPath: string;
  title: string;
  description: string;
  tags: string[];
  metadataPath: string;
  thumbnailKind: MediaKind;
  captionsSrt?: string;
}

export async function buildContentPackage(input: {
  projectDir: string;
  story: OriginalStory;
  durationSeconds: number;
  /** Generate a real JPEG via FFmpeg (default true). */
  realThumbnail?: boolean;
  /** When set, the thumbnail is a frame of this video and keeps its media kind. */
  sourceVideo?: { path: string; kind: MediaKind };
  /** License credits appended to the description. Required when music is CC-BY. */
  credits?: string;
  /** When set, captions follow these scenes across the spoken timeline. */
  captionScenes?: Array<{ narration: string; duration_seconds: number; title?: string }>;
  speechTimelineSec?: number;
  /** Original title-card still. Used instead of a bare video frame when present. */
  brandedStillPath?: string;
}): Promise<ContentPackage> {
  const dir = join(input.projectDir, "package");
  mkdirSync(dir, { recursive: true });
  const captionsPath = join(dir, "captions.vtt");
  const thumbnailPath = join(dir, "thumbnail.jpg");
  const metadataPath = join(dir, "metadata.json");
  const title = input.story.title.slice(0, 100);
  const credits = input.credits?.trim() ? `\n\nCredits:\n${input.credits.trim()}` : "";
  const description = `${input.story.logline}\n\nOriginal ToonForge cartoon. Characters: ${input.story.characters.join(", ")}.${credits}\n\n#Original #Cartoon #ToonForge`;
  const tags = ["toonforge", "original", "cartoon", ...input.story.characters].slice(0, 10);

  const srtPath = join(dir, "captions.srt");
  if (input.captionScenes && input.captionScenes.length > 0) {
    const timeline = input.speechTimelineSec && input.speechTimelineSec > 0 ? input.speechTimelineSec : input.durationSeconds;
    const track = captionTrack(input.captionScenes, timeline);
    writeFileSync(captionsPath, track.vtt);
    writeFileSync(srtPath, track.srt);
  } else {
    const endSec = Math.min(59, Math.max(1, input.durationSeconds));
    const cueEnd = `00:00:${String(endSec).padStart(2, "0")}.000`;
    writeFileSync(
      captionsPath,
      `WEBVTT\n\n00:00:00.000 --> ${cueEnd}\n${input.story.hook}\n\n00:00:01.000 --> ${cueEnd}\n${input.story.narration.slice(0, 180)}\n`,
    );
  }

  let thumbnailKind: MediaKind = "ffmpeg_dev";
  if (input.brandedStillPath) {
    thumbnailKind = input.sourceVideo && isProductionMediaKind(input.sourceVideo.kind) ? input.sourceVideo.kind : "provider";
    await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", input.brandedStillPath, thumbnailPath], {
      timeout: 60_000,
    });
    const img = await validateImage(thumbnailPath, {
      minWidth: 640,
      minHeight: 360,
      kindHint: thumbnailKind,
    });
    if (!img.ok) {
      throw new ToonForgeError({
        code: "VALIDATION_FAILED",
        message: `Thumbnail invalid: ${img.errors.join("; ")}`,
        component: "engines.packaging",
      });
    }
    writeMediaSidecar(thumbnailPath, {
      kind: thumbnailKind,
      provider: "toonforge-character-art",
      notes: ["Original title card using the episode characters. Not a frame grabbed from another creator."],
    });
  } else if (input.realThumbnail !== false && input.sourceVideo && isProductionMediaKind(input.sourceVideo.kind)) {
    thumbnailKind = input.sourceVideo.kind;
    await extractVideoFrame({ videoPath: input.sourceVideo.path, outPath: thumbnailPath });
    const img = await validateImage(thumbnailPath, {
      minWidth: 320,
      minHeight: 180,
      kindHint: thumbnailKind,
    });
    if (!img.ok) {
      throw new ToonForgeError({
        code: "VALIDATION_FAILED",
        message: `Thumbnail invalid: ${img.errors.join("; ")}`,
        component: "engines.packaging",
      });
    }
    writeMediaSidecar(thumbnailPath, {
      kind: thumbnailKind,
      provider: input.sourceVideo.kind,
      notes: ["Frame extracted from the production video. Not a separate illustration and not an ffmpeg_dev card."],
    });
  } else if (input.realThumbnail !== false) {
    await generateDevThumbnail({
      outPath: thumbnailPath,
      width: 1280,
      height: 720,
      label: title.slice(0, 32),
    });
    const img = await validateImage(thumbnailPath, {
      minWidth: 640,
      minHeight: 360,
      expectedAspect: 16 / 9,
      kindHint: "ffmpeg_dev",
    });
    if (!img.ok) {
      throw new ToonForgeError({
        code: "VALIDATION_FAILED",
        message: `Thumbnail invalid: ${img.errors.join("; ")}`,
        component: "engines.packaging",
      });
    }
    writeMediaSidecar(thumbnailPath, {
      kind: "ffmpeg_dev",
      provider: "ffmpeg",
      notes: ["DEV/CI thumbnail — replace with brand art for live publish"],
    });
  } else {
    writeFileSync(thumbnailPath, `THUMB:${title}`);
    thumbnailKind = "invalid_stub";
    writeMediaSidecar(thumbnailPath, {
      kind: "invalid_stub",
      notes: ["placeholder text thumbnail"],
    });
  }

  const chapterLines = input.captionScenes
    ? input.captionScenes.reduce<{ cursor: number; lines: string[] }>(
        (state, scene) => {
          const stamp = formatTimestamp(state.cursor).slice(0, 8);
          const timeline = input.speechTimelineSec && input.speechTimelineSec > 0 ? input.speechTimelineSec : input.durationSeconds;
          const planned = input.captionScenes?.reduce((sum, item) => sum + item.duration_seconds, 0) ?? timeline;
          const scale = planned > 0 ? timeline / planned : 1;
          state.lines.push(`${stamp} ${scene.title ?? scene.narration.slice(0, 40)}`);
          state.cursor += scene.duration_seconds * scale;
          return state;
        },
        { cursor: 0, lines: [] },
      ).lines
    : [];
  const descriptionWithChapters = chapterLines.length ? `${description}\n\nChapters:\n${chapterLines.join("\n")}` : description;
  const metadata = {
    title,
    description: descriptionWithChapters,
    tags,
    language: "en",
    categoryId: input.captionScenes ? "27" : "1",
    characters: input.story.characters,
    durationSeconds: input.durationSeconds,
    chapters: chapterLines,
    captionsSrt: input.captionScenes ? srtPath : undefined,
  };
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  return {
    captionsPath,
    thumbnailPath,
    title,
    description: descriptionWithChapters,
    tags,
    metadataPath,
    thumbnailKind,
    captionsSrt: input.captionScenes ? srtPath : undefined,
  };
}
