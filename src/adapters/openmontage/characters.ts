import type { CharacterRecord } from "../../characters/types.js";
import type { Storyboard } from "../../engines/storyboard/index.js";
import { openMontageError } from "./errors.js";
import type { CharacterMapping, OpenMontageCharacterSpec, OpenMontageScenePlan } from "./types.js";

/**
 * Identity check aligned with OpenMontage `_slug` (character_animation.py).
 * Ids that this would rewrite are rejected so the upstream tool cannot rename a character.
 */
export function openMontageSlug(value: string): string {
  const folded = [...value.trim()].map((char) => (/[a-z0-9]/i.test(char) ? char.toLowerCase() : "-")).join("");
  const slug = folded.split("-").filter(Boolean).join("-");
  return slug || "character";
}

const DERIVED_FIELDS = ["role", "required_actions", "required_views"];

export function mapCharactersToOpenMontage(records: CharacterRecord[]): CharacterMapping {
  if (!records.length) {
    throw openMontageError({
      errorClass: "compatibility",
      message: "OpenMontage character mapping requires at least one ToonForge character",
      context: { missing: ["characters"] },
    });
  }

  const characters: OpenMontageCharacterSpec[] = [];
  const preservedLocally: CharacterMapping["preservedLocally"] = [];

  for (const record of records) {
    const missing: string[] = [];
    if (!record.character_id?.trim()) missing.push("character_id");
    if (!record.display_name?.trim()) missing.push("display_name");
    if (!record.canonical_description?.trim()) missing.push("canonical_description");
    if (!record.allowed_styles?.length) missing.push("allowed_styles");
    if (!record.personality?.length) missing.push("personality");
    if (missing.length) {
      throw openMontageError({
        errorClass: "compatibility",
        message: `Character ${record.character_id || "(missing id)"} is missing identity fields required by the OpenMontage character_design schema`,
        context: { characterId: record.character_id, missing },
      });
    }
    if (openMontageSlug(record.character_id) !== record.character_id) {
      throw openMontageError({
        errorClass: "compatibility",
        message: `character_id ${record.character_id} would be rewritten by OpenMontage's slug and is rejected to preserve identity`,
        context: { characterId: record.character_id, slug: openMontageSlug(record.character_id) },
      });
    }

    const constraints = [
      `lock_face=${record.consistency.lock_face}`,
      `lock_palette=${record.consistency.lock_palette}`,
    ];
    if (record.consistency.max_drift_score != null) {
      constraints.push(`max_drift_score=${record.consistency.max_drift_score}`);
    }

    characters.push({
      id: record.character_id,
      display_name: record.display_name,
      role: record.personality[0] ?? "recurring character",
      body_type: record.canonical_description,
      style: record.allowed_styles[0] ?? "cartoon",
      silhouette_notes: record.canonical_description,
      required_emotions: [...record.personality],
      required_actions: ["idle", "blink", "look", "gesture"],
      required_views: ["front"],
      props: [...record.wardrobe],
      constraints,
    });
    preservedLocally.push({
      id: record.character_id,
      fields: ["voice", "version", "visual_reference", "omnichar_artifact"],
    });
  }

  return { characters, preservedLocally, derivedFields: DERIVED_FIELDS };
}

export function storyboardToScenePlan(board: Storyboard): OpenMontageScenePlan {
  if (!board.shots.length) {
    throw openMontageError({
      errorClass: "compatibility",
      message: "OpenMontage scene plan requires at least one storyboard shot",
      context: { missing: ["storyboard.shots"] },
    });
  }
  let cursor = 0;
  const scenes = board.shots.map((shot) => {
    const start = round(cursor);
    const end = round(cursor + Math.max(0.1, shot.duration_seconds));
    cursor = end;
    return {
      id: `${shot.scene_id}-${shot.shot_id}`,
      start_seconds: start,
      end_seconds: end,
      description: shot.visual || shot.narration || shot.dialogue || shot.scene_id,
      framing: shot.framing || "medium",
      characters: [...shot.characters],
    };
  });
  return { version: "1.0", scenes, timelineDurationSec: round(cursor) };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
