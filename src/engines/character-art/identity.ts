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
 * Missing locked phrases fail closed instead of inventing another character.
 */
export function identityFromCharacter(character: CharacterRecord): CharacterArtIdentity {
  const text = `${character.canonical_description} ${character.wardrobe.join(" ")}`.toLowerCase();
  const missing: string[] = [];
  if (!/auburn/.test(text)) missing.push("auburn hair");
  if (!/goggle/.test(text)) missing.push("goggles");
  if (!/blue hoodie/.test(text)) missing.push("blue hoodie");
  if (!/cargo shorts/.test(text)) missing.push("cargo shorts");
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
