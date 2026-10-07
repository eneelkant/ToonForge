import { newId } from "../../core/ids.js";
import type { OriginalStory } from "../story/index.js";

export interface StoryboardShot {
  shot_id: string;
  scene_id: string;
  order: number;
  duration_seconds: number;
  camera: string;
  framing: string;
  characters: string[];
  dialogue: string;
  narration: string;
  visual: string;
  transition: string;
  audio_cues: string[];
}

export interface Storyboard {
  storyboard_id: string;
  story_id: string;
  shots: StoryboardShot[];
  version: string;
}

export function createStoryboard(story: OriginalStory): Storyboard {
  const shots: StoryboardShot[] = [];
  let order = 1;
  for (const scene of story.scenes) {
    shots.push({
      shot_id: `shot_${String(order).padStart(3, "0")}`,
      scene_id: scene.id,
      order,
      duration_seconds: scene.duration_seconds,
      camera: order === 1 ? "push-in" : "static",
      framing: order === 1 ? "close-up" : "medium",
      characters: scene.characters,
      dialogue: scene.dialogue,
      narration: scene.narration,
      visual: scene.action,
      transition: order === story.scenes.length ? "fade-out" : "cut",
      audio_cues: ["sfx:whoosh", "music:underscore"],
    });
    order += 1;
  }
  return {
    storyboard_id: newId("sb"),
    story_id: story.story_id,
    shots,
    version: "1.0.0",
  };
}

export function regenerateShot(board: Storyboard, shotId: string, patch: Partial<StoryboardShot>): Storyboard {
  return {
    ...board,
    shots: board.shots.map((s) => (s.shot_id === shotId ? { ...s, ...patch, shot_id: s.shot_id, order: s.order } : s)),
    version: bump(board.version),
  };
}

function bump(version: string): string {
  const parts = version.split(".").map(Number);
  parts[2] = (parts[2] ?? 0) + 1;
  return parts.join(".");
}
