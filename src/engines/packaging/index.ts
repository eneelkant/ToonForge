import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

export interface ContentPackage {
  captionsPath: string;
  thumbnailPath: string;
  title: string;
  description: string;
  tags: string[];
  metadataPath: string;
  thumbnailKind: MediaKind;
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

  const endSec = Math.min(59, Math.max(1, input.durationSeconds));
  const cueEnd = `00:00:${String(endSec).padStart(2, "0")}.000`;
  writeFileSync(
    captionsPath,
    `WEBVTT\n\n00:00:00.000 --> ${cueEnd}\n${input.story.hook}\n\n00:00:01.000 --> ${cueEnd}\n${input.story.narration.slice(0, 180)}\n`,
  );

  let thumbnailKind: MediaKind = "ffmpeg_dev";
  if (input.realThumbnail !== false && input.sourceVideo && isProductionMediaKind(input.sourceVideo.kind)) {
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

  const metadata = {
    title,
    description,
    tags,
    language: "en",
    categoryId: "1",
    characters: input.story.characters,
    durationSeconds: input.durationSeconds,
  };
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  return {
    captionsPath,
    thumbnailPath,
    title,
    description,
    tags,
    metadataPath,
    thumbnailKind,
  };
}
