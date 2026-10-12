import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ToonForgeError } from "../../core/errors.js";
import { newId } from "../../core/ids.js";
import type { CharacterRecord } from "../../characters/types.js";
import type { OriginalStory } from "../story/index.js";

const sourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  author: z.string().min(1).optional(),
  url: z.string().url(),
  inspected: z.boolean(),
  accessed: z.string().min(4),
  supports: z.string().min(12),
});

const claimSchema = z.object({
  text: z.string().min(12),
  status: z.enum(["documented", "disputed", "legend", "dramatization"]),
  sources: z.array(z.string()),
});

const sceneSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  narration: z.string().min(40),
  action: z.string().min(8),
  dialogue: z.string().default(""),
  duration_seconds: z.number().int().positive(),
  characters: z.array(z.string()).min(1),
  camera: z.string().min(1),
  on_screen_text: z.string().optional(),
});

const episodeSchema = z.object({
  topic: z.string().min(8),
  audience: z.string().min(8),
  learning_objective: z.string().min(12),
  title: z.string().min(8),
  guides_are_fictional: z.literal(true),
  claims: z.array(claimSchema).min(3),
  sources: z.array(sourceSchema).min(2),
  scenes: z.array(sceneSchema).min(6),
});

export type HistoryEpisode = z.infer<typeof episodeSchema>;

const ALLOWED_CHARACTERS = new Set(["mila", "milo-monkey"]);

export function loadHistoryEpisode(path: string): HistoryEpisode {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch (error) {
    throw new ToonForgeError({
      code: "CONFIG_INVALID",
      message: `History episode could not be read at ${path}: ${error instanceof Error ? error.message : String(error)}`,
      component: "engines.history",
    });
  }
  const parsed = episodeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `History episode is invalid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      component: "engines.history",
    });
  }
  validateHistoryEpisode(parsed.data);
  return parsed.data;
}

export function validateHistoryEpisode(episode: HistoryEpisode): void {
  const errors: string[] = [];
  const sourceIds = new Set(episode.sources.map((source) => source.id));
  if (episode.sources.some((source) => !source.inspected)) {
    errors.push("every source must be inspected before it can support an episode");
  }
  if (episode.sources.some((source) => !source.url.startsWith("https://"))) {
    errors.push("sources need https URLs");
  }
  for (const claim of episode.claims) {
    if (claim.status === "dramatization") continue;
    if (claim.sources.length === 0) errors.push(`claim "${claim.text.slice(0, 48)}" has no source`);
    for (const sourceId of claim.sources) {
      if (!sourceIds.has(sourceId)) errors.push(`claim cites missing source ${sourceId}`);
    }
  }
  if (!episode.claims.some((claim) => claim.status === "documented")) errors.push("at least one documented claim is required");
  if (!episode.claims.some((claim) => claim.status === "disputed")) errors.push("disputed points must be labeled");
  if (!episode.claims.some((claim) => claim.status === "legend")) errors.push("legends must be labeled separately from facts");
  const narration = episode.scenes.map((scene) => scene.narration).join(" ");
  if (!/were not/i.test(narration) || !/witness/i.test(narration)) {
    errors.push("the narration must say the guides were not witnesses");
  }
  const seconds = episode.scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0);
  if (seconds < 300 || seconds > 600) errors.push(`history storyboard is ${seconds}s, outside 300–600`);
  for (const scene of episode.scenes) {
    for (const id of scene.characters) {
      if (!ALLOWED_CHARACTERS.has(id)) errors.push(`scene ${scene.id} uses ${id}, which is not Mila or Milo`);
    }
  }
  if (errors.length) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `History research gate failed: ${errors.join("; ")}`,
      component: "engines.history",
      context: { errors },
    });
  }
}

export function storyFromHistoryEpisode(episode: HistoryEpisode, characters: CharacterRecord[]): OriginalStory {
  const allowed = new Set(characters.map((character) => character.character_id));
  for (const scene of episode.scenes) {
    for (const id of scene.characters) {
      if (!allowed.has(id)) {
        throw new ToonForgeError({
          code: "VALIDATION_FAILED",
          message: `History scene ${scene.id} needs character ${id} in the channel cast.`,
          component: "engines.history",
        });
      }
    }
  }
  const duration = episode.scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0);
  const narration = episode.scenes.map((scene) => scene.narration.trim()).join(" ");
  const body = JSON.stringify({ title: episode.title, narration, duration });
  return {
    story_id: newId("story"),
    title: episode.title,
    logline: `${episode.topic} An original history short for ${episode.audience}. Learning objective: ${episode.learning_objective}`,
    hook: episode.scenes[0]?.narration ?? episode.topic,
    synopsis: episode.learning_objective,
    characters: [...new Set(episode.scenes.flatMap((scene) => scene.characters))],
    scenes: episode.scenes.map((scene) => ({
      id: scene.id,
      title: scene.title,
      action: scene.action,
      dialogue: scene.dialogue,
      narration: scene.narration,
      duration_seconds: scene.duration_seconds,
      characters: scene.characters,
      camera: scene.camera,
      on_screen_text: scene.on_screen_text,
    })),
    narration,
    dialogue: episode.scenes.map((scene) => scene.dialogue).filter(Boolean),
    duration_target: duration,
    format: "long_form",
    originality_notes: [
      "Original narration. Mila and Milo are fictional guides and are not quoted as historical witnesses.",
      ...episode.sources.map((source) => `Source ${source.id}: ${source.title}. ${source.url}`),
    ],
    risk_flags: [],
    version: "1.0.0",
    script_hash: createHash("sha256").update(body).digest("hex"),
  };
}

export function historyCredits(episode: HistoryEpisode): string {
  return episode.sources
    .map((source) => `${source.title}${source.author ? `, ${source.author}` : ""}. ${source.url}`)
    .join("\n");
}
