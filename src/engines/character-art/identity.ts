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
  kind: "max" | "mila" | "milo-monkey";
  hair: string;
  hoodie: string;
  shorts: string;
  skin: string;
  ink: string;
  goggles: boolean;
  messyHair: boolean;
  cargoShorts: boolean;
  /** Extra locked fills for characters other than Max. */
  requiredFills?: string[];
  requiredPartIds?: string[];
}

export const MILA_PALETTE = {
  hair: "#7a4ea3",
  hairDark: "#5c347f",
  skin: "#f3b7c8",
  cap: "#f48fb1",
  stripe: "#d64550",
  shirt: "#f7c1d4",
  backpack: "#5c3d86",
  trousers: "#3d2a5c",
  boots: "#f2c14e",
  eyes: "#6b3e26",
  ink: "#2a2118",
} as const;

export const MILO_MONKEY_PALETTE = {
  fur: "#e2b13c",
  furDark: "#c48a22",
  face: "#f3d2a2",
  belly: "#f6e0bf",
  eyes: "#6b3e26",
  tuft: "#f0c85a",
  ink: "#3a2a16",
} as const;

/**
 * Build a drawable identity from the configured character record.
 * Missing locked phrases fail closed instead of inventing another character.
 */
function rejectIdentity(character: CharacterRecord, missing: string[]): never {
  throw new ToonForgeError({
    code: "VALIDATION_FAILED",
    message: `Character ${character.character_id || "(missing id)"} is missing locked visual tokens (${missing.join(", ")}). Refusing to invent a different design.`,
    component: "engines.character-art",
    context: { characterId: character.character_id, missing },
  });
}

export function identityFromCharacter(character: CharacterRecord): CharacterArtIdentity {
  if (character.character_id === "mila") return milaIdentity(character);
  if (character.character_id === "milo-monkey") return miloMonkeyIdentity(character);
  if (character.character_id !== "max") {
    rejectIdentity(character, [`finished art for ${character.character_id || "this id"}`]);
  }
  const text = `${character.canonical_description} ${character.wardrobe.join(" ")}`.toLowerCase();
  const missing: string[] = [];
  if (!/auburn/.test(text)) missing.push("auburn hair");
  if (!/goggle/.test(text)) missing.push("goggles");
  if (!/blue hoodie/.test(text)) missing.push("blue hoodie");
  if (!/cargo shorts/.test(text)) missing.push("cargo shorts");
  if (!character.allowed_styles.includes("cartoon")) missing.push("allowed style cartoon");
  if (!character.character_id.trim() || !character.display_name.trim()) missing.push("id and display name");
  if (missing.length > 0) rejectIdentity(character, missing);
  return {
    id: character.character_id,
    displayName: character.display_name,
    kind: "max",
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

function milaIdentity(character: CharacterRecord): CharacterArtIdentity {
  const text = `${character.canonical_description} ${character.wardrobe.join(" ")}`.toLowerCase();
  const missing: string[] = [];
  if (!/purple hair/.test(text)) missing.push("purple hair");
  if (!/pink/.test(text) || !/cap/.test(text)) missing.push("pink cap");
  if (!/stripe/.test(text)) missing.push("striped shirt");
  if (!/backpack/.test(text)) missing.push("purple backpack");
  if (!/trouser|legging/.test(text)) missing.push("purple trousers");
  if (!/yellow boot/.test(text)) missing.push("yellow boots");
  if (!/pink skin/.test(text)) missing.push("pink skin");
  if (character.display_name !== "Mila") missing.push("display name Mila");
  if (!character.allowed_styles.includes("cartoon")) missing.push("allowed style cartoon");
  if (missing.length) rejectIdentity(character, missing);
  return {
    id: "mila",
    displayName: "Mila",
    kind: "mila",
    hair: MILA_PALETTE.hair,
    hoodie: MILA_PALETTE.shirt,
    shorts: MILA_PALETTE.trousers,
    skin: MILA_PALETTE.skin,
    ink: MILA_PALETTE.ink,
    goggles: false,
    messyHair: true,
    cargoShorts: false,
    requiredFills: [MILA_PALETTE.hair, MILA_PALETTE.cap, MILA_PALETTE.stripe, MILA_PALETTE.backpack, MILA_PALETTE.trousers, MILA_PALETTE.boots, MILA_PALETTE.skin],
    requiredPartIds: [
      "mila-hair",
      "mila-cap",
      "mila-shirt",
      "mila-backpack",
      "mila-trousers",
      "mila-boot-left",
      "mila-boot-right",
      "mila-mouth",
      "mila-arm-left",
      "mila-arm-right",
      "mila-hand-left",
      "mila-hand-right",
      "mila-eye-left",
      "mila-eye-right",
    ],
  };
}

function miloMonkeyIdentity(character: CharacterRecord): CharacterArtIdentity {
  const text = `${character.canonical_description} ${character.wardrobe.join(" ")}`.toLowerCase();
  const missing: string[] = [];
  if (!/golden|yellow fur/.test(text)) missing.push("golden fur");
  if (!/tan/.test(text)) missing.push("tan face");
  if (!/brown eyes/.test(text)) missing.push("brown eyes");
  if (!/ear/.test(text)) missing.push("ears");
  if (!/tail/.test(text)) missing.push("curled tail");
  if (!/tuft/.test(text)) missing.push("hair tuft");
  if (character.wardrobe.some((item) => !/no clothing/i.test(item))) missing.push("no clothing");
  if (character.display_name !== "Milo") missing.push("display name Milo");
  if (!character.allowed_styles.includes("cartoon")) missing.push("allowed style cartoon");
  if (missing.length) rejectIdentity(character, missing);
  return {
    id: "milo-monkey",
    displayName: "Milo",
    kind: "milo-monkey",
    hair: MILO_MONKEY_PALETTE.fur,
    hoodie: MILO_MONKEY_PALETTE.fur,
    shorts: MILO_MONKEY_PALETTE.belly,
    skin: MILO_MONKEY_PALETTE.face,
    ink: MILO_MONKEY_PALETTE.ink,
    goggles: false,
    messyHair: true,
    cargoShorts: false,
    requiredFills: [MILO_MONKEY_PALETTE.fur, MILO_MONKEY_PALETTE.face, MILO_MONKEY_PALETTE.belly, MILO_MONKEY_PALETTE.tuft],
    requiredPartIds: [
      "milo-fur",
      "milo-face",
      "milo-belly",
      "milo-ear-left",
      "milo-ear-right",
      "milo-muzzle",
      "milo-tuft",
      "milo-tail",
      "milo-mouth",
      "milo-arm-left",
      "milo-arm-right",
      "milo-hand-left",
      "milo-hand-right",
      "milo-eye-left",
      "milo-eye-right",
    ],
  };
}
