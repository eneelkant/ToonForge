import { createHash } from "node:crypto";
import { newId } from "../../core/ids.js";
import type { CharacterRecord } from "../../characters/types.js";
import type { TrendCandidate } from "../trend/index.js";
import type { ReferenceAnalysisReport } from "../../adapters/reelmimic/types.js";
import { toStoryFormatHints, type StoryFormatHints } from "../reference/index.js";

export interface StoryScene {
  id: string;
  title: string;
  action: string;
  dialogue: string;
  narration: string;
  duration_seconds: number;
  characters: string[];
}

/**
 * Materially original story. Format hints may influence structure/pacing only —
 * never copied dialogue, scripts, or protected expression from a reference.
 */
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
  /** Explicit format-level signals used (structure only). */
  format_hints?: StoryFormatHints;
  originality_notes: string[];
  risk_flags: string[];
  version: string;
  script_hash: string;
}

export function generateOriginalStory(input: {
  trend?: TrendCandidate;
  characters: CharacterRecord[];
  reference?: ReferenceAnalysisReport | null;
  formatHints?: StoryFormatHints | null;
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
  const hints =
    input.formatHints ?? (input.reference ? toStoryFormatHints(input.reference) : null);

  const shotHint = hints?.shot_count
    ? `Format analysis suggests ~${hints.shot_count} shot rhythm (structure only)`
    : "Default short pacing (no format analysis)";
  const hookPattern = hints?.hook_pattern ?? "problem-in-first-3s";
  const structure = hints?.scene_structure?.length
    ? hints.scene_structure
    : ["hook", "escalation", "payoff"];

  const scenes: StoryScene[] = structure.slice(0, 4).map((label, index) => {
    const portion = index === 0 ? 0.2 : index === structure.length - 1 ? 0.35 : 0.45 / Math.max(1, structure.length - 2);
    if (label === "hook" || index === 0) {
      return {
        id: `sc_${String(index + 1).padStart(2, "0")}`,
        title: "Hook",
        action: `${lead.display_name} discovers an unexpected problem.`,
        dialogue: `${lead.display_name}: "We can fix this — our way!"`,
        narration: `When a tiny crisis pops up, ${lead.display_name} leaps into action.`,
        duration_seconds: Math.round(duration * portion),
        characters: [lead.character_id],
      };
    }
    if (label === "payoff" || index === structure.length - 1) {
      return {
        id: `sc_${String(index + 1).padStart(2, "0")}`,
        title: "Resolution",
        action: `The plan works in a surprising, original way.`,
        dialogue: `${lead.display_name}: "That's our story — brand new!"`,
        narration: `The day is saved, and the friends celebrate their own solution.`,
        duration_seconds: Math.round(duration * portion),
        characters: chars.map((c) => c.character_id),
      };
    }
    return {
      id: `sc_${String(index + 1).padStart(2, "0")}`,
      title: "Escalation",
      action: side
        ? `${lead.display_name} and ${side.display_name} try a creative plan.`
        : `${lead.display_name} invents a clever workaround.`,
      dialogue: side
        ? `${side.display_name}: "Step one: don't panic. Step two: invent!"`
        : `${lead.display_name}: "Version two is always better."`,
      narration: `Together they experiment, fail once, and learn fast.`,
      duration_seconds: Math.round(duration * portion),
      characters: chars.slice(0, 2).map((c) => c.character_id),
    };
  });

  const title = `${lead.display_name} and the Original Fix`;
  const narration = scenes.map((s) => s.narration).join(" ");
  const dialogue = scenes.map((s) => s.dialogue);
  const body = JSON.stringify({ title, scenes, narration, dialogue, topic, hookPattern });
  const script_hash = createHash("sha256").update(body).digest("hex");

  return {
    story_id: newId("story"),
    trend_id: input.trend?.id,
    title,
    logline: `An original cartoon short where ${lead.display_name} solves a problem inspired by the theme "${topic}" without copying any reference expression.`,
    hook: scenes[0]!.dialogue,
    synopsis: `Theme: ${topic}. Hook pattern (structure only): ${hookPattern}. ${shotHint}.`,
    characters: chars.map((c) => c.character_id),
    scenes,
    narration,
    dialogue,
    duration_target: duration,
    format: input.format ?? "shorts",
    format_hints: hints ?? undefined,
    originality_notes: [
      "New title, dialogue, and plot beats generated for ToonForge characters",
      shotHint,
      `Story structure labels: ${structure.join(" → ")} (format inspiration, original expression)`,
      "No third-party footage, music, or copyrighted characters used",
      hints?.offline_fixture
        ? "Format hints from offline fixture analysis (not a live reference video)"
        : "Format hints from reference analysis report when available",
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
