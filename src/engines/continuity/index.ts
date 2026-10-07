import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CharacterRecord } from "../../characters/types.js";
import type { OmniCharAdapter } from "../../adapters/omnichar/types.js";
import type { Storyboard } from "../storyboard/index.js";

export interface CharacterVersionPin {
  character_id: string;
  version: string;
  omnichar_file?: string | null;
  continuity_ok: boolean;
  detail: string;
}

export interface ContinuityPlan {
  projectId: string;
  pins: CharacterVersionPin[];
  perShot: Array<{ shot_id: string; character_ids: string[] }>;
}

export async function buildContinuityPlan(input: {
  projectId: string;
  characters: CharacterRecord[];
  storyboard: Storyboard;
  omnichar?: OmniCharAdapter | null;
}): Promise<ContinuityPlan> {
  const pins: CharacterVersionPin[] = [];
  for (const character of input.characters) {
    let continuity_ok = true;
    let detail = "local registry pin";
    let omnichar_file: string | null = character.omnichar_artifact ?? null;
    if (input.omnichar) {
      try {
        const result = await input.omnichar.validateContinuity(character.character_id);
        continuity_ok = result.ok;
        detail = result.detail;
        omnichar_file = result.summary?.file ?? omnichar_file;
      } catch (error) {
        continuity_ok = false;
        detail = error instanceof Error ? error.message : String(error);
      }
    }
    pins.push({
      character_id: character.character_id,
      version: character.version,
      omnichar_file,
      continuity_ok,
      detail,
    });
  }

  return {
    projectId: input.projectId,
    pins,
    perShot: input.storyboard.shots.map((s) => ({
      shot_id: s.shot_id,
      character_ids: s.characters,
    })),
  };
}

export function persistContinuityPlan(projectDir: string, plan: ContinuityPlan): string {
  mkdirSync(projectDir, { recursive: true });
  const path = join(projectDir, "character-continuity.json");
  writeFileSync(path, JSON.stringify(plan, null, 2));
  return path;
}

export function loadContinuityPlan(projectDir: string): ContinuityPlan | null {
  const path = join(projectDir, "character-continuity.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ContinuityPlan;
}

export function validateContinuityPlan(plan: ContinuityPlan): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const pin of plan.pins) {
    if (!pin.version) errors.push(`${pin.character_id}: missing version`);
    if (!pin.continuity_ok) errors.push(`${pin.character_id}: ${pin.detail}`);
  }
  for (const shot of plan.perShot) {
    for (const id of shot.character_ids) {
      if (!plan.pins.some((p) => p.character_id === id)) {
        errors.push(`${shot.shot_id}: character ${id} not pinned`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
