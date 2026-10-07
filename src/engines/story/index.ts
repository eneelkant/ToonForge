import { createHash } from "node:crypto";
import { newId } from "../../core/ids.js";
import type { CharacterRecord } from "../../characters/types.js";
import type { TrendCandidate } from "../trend/index.js";
import type { ReferenceAnalysisReport } from "../../adapters/reelmimic/types.js";

export interface StoryScene {
  id: string;
  title: string;
  action: string;
  dialogue: string;
  narration: string;
  duration_seconds: number;
  characters: string[];
}

export interface OriginalStory {
  story_id: string;
  trend_id?: string;
  title: string;
  logline: string;
  hook: string;
  synopsis: string;
  characters: string[];
  scenes: StoryScene[];
  narration: string;
  dialogue: string[];
  duration_target: number;
  format: "shorts" | "long_form";
  originality_notes: string[];
  risk_flags: string[];
  version: string;
  script_hash: string;
}

export function generateOriginalStory(input: {
  trend?: TrendCandidate;
  characters: CharacterRecord[];
  reference?: ReferenceAnalysisReport | null;
  durationTarget?: number;
  format?: "shorts" | "long_form";
}): OriginalStory {
  const chars = input.characters;
  if (chars.length === 0) {
    throw new Error("At least one canonical character is required");
  }
  const lead = chars[0]!;
  const side = chars[1];
  const duration = input.durationTarget ?? 45;
  const topic = input.trend?.topic ?? "everyday cartoon adventure";
  const pacingNote = input.reference?.shot_count
    ? `Inspired by reference pacing (~${input.reference.shot_count} shots), not copied content`
    : "No reference analysis; using default short pacing";

  const scenes: StoryScene[] = [
    {
      id: "sc_01",
      title: "Hook",
      action: `${lead.display_name} discovers an unexpected problem.`,
      dialogue: `${lead.display_name}: "We can fix this — our way!"`,
      narration: `When a tiny crisis pops up, ${lead.display_name} leaps into action.`,
      duration_seconds: Math.round(duration * 0.2),
      characters: [lead.character_id],
    },
    {
      id: "sc_02",
      title: "Teamwork",
      action: side
        ? `${lead.display_name} and ${side.display_name} try a creative plan.`
        : `${lead.display_name} invents a clever workaround.`,
      dialogue: side
        ? `${side.display_name}: "Step one: don't panic. Step two: invent!"`
        : `${lead.display_name}: "Version two is always better."`,
      narration: `Together they experiment, fail once, and learn fast.`,
      duration_seconds: Math.round(duration * 0.45),
      characters: chars.slice(0, 2).map((c) => c.character_id),
    },
    {
      id: "sc_03",
      title: "Resolution",
      action: `The plan works in a surprising, original way.`,
      dialogue: `${lead.display_name}: "That's our story — brand new!"`,
      narration: `The day is saved, and the friends celebrate their own solution.`,
      duration_seconds: Math.round(duration * 0.35),
      characters: chars.map((c) => c.character_id),
    },
  ];

  const title = `${lead.display_name} and the Original Fix`;
  const narration = scenes.map((s) => s.narration).join(" ");
  const dialogue = scenes.map((s) => s.dialogue);
  const body = JSON.stringify({ title, scenes, narration, dialogue, topic });
  const script_hash = createHash("sha256").update(body).digest("hex");

  return {
    story_id: newId("story"),
    trend_id: input.trend?.id,
    title,
    logline: `An original cartoon short where ${lead.display_name} solves a problem inspired by the theme "${topic}" without copying any reference expression.`,
    hook: scenes[0]!.dialogue,
    synopsis: `Theme: ${topic}. ${pacingNote}.`,
    characters: chars.map((c) => c.character_id),
    scenes,
    narration,
    dialogue,
    duration_target: duration,
    format: input.format ?? "shorts",
    originality_notes: [
      "New title, dialogue, and plot beats generated for ToonForge characters",
      pacingNote,
      "No third-party footage, music, or copyrighted characters used",
    ],
    risk_flags: [],
    version: "1.0.0",
    script_hash,
  };
}

export function validateStory(story: OriginalStory): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!story.title.trim()) errors.push("title required");
  if (story.scenes.length < 2) errors.push("at least 2 scenes required");
  if (!story.characters.length) errors.push("characters required");
  if (story.duration_target <= 0) errors.push("duration_target must be positive");
  if (story.risk_flags.includes("copied_text")) errors.push("copied_text risk");
  const joined = `${story.title}\n${story.synopsis}\n${story.narration}`.toLowerCase();
  if (joined.includes("as seen on youtube") || joined.includes("subscribe for more from the original channel")) {
    errors.push("possible reused promotional language");
  }
  return { ok: errors.length === 0, errors };
}
