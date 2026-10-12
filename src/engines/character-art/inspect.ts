import type { CharacterArtIdentity } from "./identity.js";

export interface ArtInspection {
  ok: boolean;
  characterId?: string;
  findings: string[];
}

const REQUIRED_IDS = ["hair", "goggles", "hoodie", "shorts", "mouth", "arm-left", "arm-right", "hand-left", "hand-right", "eye-left", "eye-right"];

/** Markers that identify the OpenMontage schematic rig. Original art must not carry them. */
const SCHEMATIC_MARKERS = ['cy="230" r="90"', "#9bd7ff", "#75c878", "gsap", "cdn.jsdelivr.net"];

/**
 * Structural inspection of a character frame.
 * A successful renderer exit code is not a substitute for this check.
 */
export function inspectCharacterArtSvg(svg: string, identity?: CharacterArtIdentity): ArtInspection {
  const findings: string[] = [];
  const idMatches = [...svg.matchAll(/data-character-id="([^"]+)"/g)].map((match) => match[1] ?? "");
  const characterId = idMatches[0];
  if (!characterId) findings.push("missing data-character-id");
  const name = svg.match(/data-display-name="([^"]+)"/);
  if (!name?.[1]) findings.push("missing data-display-name");
  for (const marker of SCHEMATIC_MARKERS) {
    if (svg.includes(marker)) findings.push(`schematic marker present: ${marker}`);
  }
  if (!svg.includes('stroke-linecap="round"')) findings.push("missing deliberate rounded outlines");
  if (identity?.requiredPartIds) {
    if (!idMatches.includes(identity.id)) findings.push(`character id does not include registry ${identity.id}`);
    if (!svg.includes(`data-display-name="${identity.displayName}"`)) findings.push("display name does not match the registry");
    for (const id of identity.requiredPartIds) {
      if (!svg.includes(`id="${id}"`)) findings.push(`missing part ${id}`);
    }
    for (const fill of identity.requiredFills ?? []) {
      if (!svg.includes(`fill="${fill}"`)) findings.push(`missing locked fill ${fill}`);
    }
  } else {
    for (const id of REQUIRED_IDS) {
      if (!svg.includes(`id="${id}"`)) findings.push(`missing part ${id}`);
    }
    if (identity) {
      if (characterId !== identity.id) findings.push(`character id ${characterId ?? "none"} does not match registry ${identity.id}`);
      if (name?.[1] !== identity.displayName) findings.push("display name does not match the registry");
      if (!svg.includes(`fill="${identity.hair}"`)) findings.push("auburn hair fill missing");
      if (!svg.includes(`fill="${identity.hoodie}"`)) findings.push("blue hoodie fill missing");
      if (!svg.includes(`fill="${identity.shorts}"`)) findings.push("cargo shorts fill missing");
      if (!svg.includes(`fill="${identity.skin}"`)) findings.push("skin fill missing");
    }
  }
  return { ok: findings.length === 0, characterId, findings };
}
