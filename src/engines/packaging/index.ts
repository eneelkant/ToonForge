import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OriginalStory } from "../story/index.js";

export interface ContentPackage {
  captionsPath: string;
  thumbnailPath: string;
  title: string;
  description: string;
  tags: string[];
  metadataPath: string;
}

export function buildContentPackage(input: {
  projectDir: string;
  story: OriginalStory;
  durationSeconds: number;
}): ContentPackage {
  const dir = join(input.projectDir, "package");
  mkdirSync(dir, { recursive: true });
  const captionsPath = join(dir, "captions.vtt");
  const thumbnailPath = join(dir, "thumbnail.jpg");
  const metadataPath = join(dir, "metadata.json");
  const title = input.story.title.slice(0, 100);
  const description = `${input.story.logline}\n\nOriginal ToonForge cartoon. Characters: ${input.story.characters.join(", ")}.`;
  const tags = ["toonforge", "original", "cartoon", ...input.story.characters].slice(0, 10);
  writeFileSync(
    captionsPath,
    `WEBVTT\n\n00:00:00.000 --> 00:00:${String(Math.min(59, input.durationSeconds)).padStart(2, "0")}.000\n${input.story.hook}\n`,
  );
  writeFileSync(thumbnailPath, `THUMB:${title}`);
  const metadata = { title, description, tags, language: "en", categoryId: "1" };
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  return { captionsPath, thumbnailPath, title, description, tags, metadataPath };
}
