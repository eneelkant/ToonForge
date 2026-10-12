import type { CharacterRecord } from "../../characters/types.js";
import { ToonForgeError } from "../../core/errors.js";

/**
 * Original palette for the registry phrases on Max.
 * These hex values are ToonForge choices for those words. They are not copied
 * from OpenMontage's schematic fills.
 */
export const MAX_PALETTE = {
  hair: "#8d3b2a",
  hairDark: "#6b2a1e",
  skin: "#f3c7a1",
  hoodie: "#2f6fed",
  hoodieDark: "#1d4eb8",
  shorts: "#c4a574",
  shortsPocket: "#a88858",
  ink: "#2a2118",
} as const;

export interface CharacterArtIdentity {
  id: string;
  displayName: string;
  hair: string;
  hoodie: string;
  shorts: string;
  skin: string;
  ink: string;
  goggles: true;
  messyHair: boolean;
  cargoShorts: true;
}

/**
 * Build a drawable identity from the configured character record.
 * Each character is checked against that character's own locked phrases.
 * Only Max has a finished SVG rig. Other registry characters fail closed
 * instead of being redrawn as Max.
 */
export function identityFromCharacter(character: CharacterRecord): CharacterArtIdentity {
  const id = character.character_id.trim();
  if (id === "max") return maxIdentity(character);
  if (id === "bolt") return boltIdentity(character);
  if (id === "milo") return miloIdentity(character);
  throw new ToonForgeError({
    code: "VALIDATION_FAILED",
    message: `Character ${id || "(missing id)"} has no locked design in the character-art renderer. Refusing to invent a design.`,
    component: "engines.character-art",
    context: { characterId: character.character_id },
  });
}

function characterText(character: CharacterRecord): string {
  return `${character.canonical_description} ${character.wardrobe.join(" ")}`.toLowerCase();
}

function requireTokens(character: CharacterRecord, checks: Array<[RegExp, string]>, displayName: string): string {
  const text = characterText(character);
  const missing = [...new Set(checks.filter(([pattern]) => !pattern.test(text)).map(([, label]) => label))];
  if (character.display_name.trim().toLowerCase() !== displayName.toLowerCase()) {
    missing.push(`display name ${displayName}`);
  }
  if (!character.allowed_styles.includes("cartoon")) missing.push("allowed style cartoon");
  if (!character.character_id.trim() || !character.display_name.trim()) missing.push("id and display name");
  if (missing.length > 0) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `Character ${character.character_id || "(missing id)"} is missing locked visual tokens (${missing.join(", ")}). Refusing to invent a different design.`,
      component: "engines.character-art",
      context: { characterId: character.character_id, missing },
    });
  }
  return text;
}

function unfinished(character: CharacterRecord, design: string): never {
  throw new ToonForgeError({
    code: "VALIDATION_FAILED",
    message: `Character ${character.character_id} matches its locked design (${design}) but has no finished SVG rig. Refusing to draw Max in its place.`,
    component: "engines.character-art",
    context: { characterId: character.character_id, finishedArt: false },
  });
}

function maxIdentity(character: CharacterRecord): CharacterArtIdentity {
  const text = requireTokens(character, [
    [/auburn/, "auburn hair"],
    [/goggle/, "goggles"],
    [/blue hoodie/, "blue hoodie"],
    [/cargo shorts/, "cargo shorts"],
  ], "Max");
  return {
    id: character.character_id,
    displayName: character.display_name,
    hair: MAX_PALETTE.hair,
    hoodie: MAX_PALETTE.hoodie,
    shorts: MAX_PALETTE.shorts,
    skin: MAX_PALETTE.skin,
    ink: MAX_PALETTE.ink,
    goggles: true,
    messyHair: /messy/.test(text),
    cargoShorts: true,
  };
}

function boltIdentity(character: CharacterRecord): CharacterArtIdentity {
  requireTokens(character, [
    [/yellow/, "yellow chassis"],
    [/chassis/, "yellow chassis"],
    [/visor/, "visor eye"],
    [/gripper/, "gripper hands"],
  ], "Bolt");
  return unfinished(character, "yellow chassis, visor eye, gripper hands");
}

function miloIdentity(character: CharacterRecord): CharacterArtIdentity {
  requireTokens(character, [
    [/fox/, "cartoon fox"],
    [/cream/, "cream fur"],
    [/rust/, "rust fur"],
    [/green scarf/, "green scarf"],
  ], "Milo");
  return unfinished(character, "cartoon fox, cream fur, rust fur, green scarf");
}
