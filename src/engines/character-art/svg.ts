import type { CharacterArtIdentity } from "./identity.js";
import { MAX_PALETTE } from "./identity.js";
import type { PoseState } from "./poses.js";

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function eye(id: string, cx: number, pose: PoseState): string {
  const irisRy = Math.max(6, pose.eyeRy * 0.46);
  return `<g id="${id}" transform="translate(${cx} -336) scale(1 ${pose.eyeScaleY})">
      <ellipse cx="0" cy="0" rx="18" ry="${pose.eyeRy}" fill="#fffaf4" stroke="${MAX_PALETTE.ink}" stroke-width="4"/>
      <ellipse cx="${pose.pupilX * 0.35}" cy="${pose.pupilY + 1}" rx="8" ry="${irisRy}" fill="#2f6b4a"/>
      <circle cx="${pose.pupilX}" cy="${pose.pupilY}" r="4.4" fill="#1b1a17"/>
      <circle cx="${pose.pupilX - 4}" cy="${pose.pupilY - 5}" r="2.1" fill="#ffffff"/>
    </g>`;
}

function mouth(pose: PoseState): string {
  if (pose.mouth === "open") {
    return `<g id="mouth">
      <ellipse cx="0" cy="-292" rx="14" ry="16" fill="#6e2430" stroke="${MAX_PALETTE.ink}" stroke-width="4"/>
      <path d="M-10 -286 Q0 -278 10 -286" fill="none" stroke="#f0b3b8" stroke-width="3" stroke-linecap="round"/>
    </g>`;
  }
  if (pose.mouth === "soft") {
    return `<path id="mouth" d="M-14 -298 Q0 -288 16 -300" fill="none" stroke="#6e2430" stroke-width="5" stroke-linecap="round"/>`;
  }
  return `<path id="mouth" d="M-20 -302 Q0 -278 20 -302" fill="none" stroke="#6e2430" stroke-width="5" stroke-linecap="round"/>`;
}

function storyProp(pose: PoseState, ink: string): string {
  if (pose.name === "look" || pose.name === "blink") {
    return `<g id="story-prop" transform="translate(880 452)">
      <circle r="46" fill="#ffe7a0" opacity="0.55"/>
      <circle r="28" fill="#e2b84a" stroke="${ink}" stroke-width="4"/>
      <circle r="9" fill="#fff6dc" stroke="${ink}" stroke-width="3"/>
      <path d="M0 -40 V-28 M0 28 V40 M-40 0 H-28 M28 0 H40 M-28 -28 L-20 -20 M20 20 L28 28 M-28 28 L-20 20 M20 -20 L28 -28" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>
    </g>`;
  }
  if (pose.name === "gesture") {
    return `<g id="story-prop" transform="translate(870 468)">
      <rect x="-46" y="-28" width="92" height="40" rx="10" fill="#6f8f86" stroke="${ink}" stroke-width="4"/>
      <rect x="-16" y="-48" width="32" height="24" rx="6" fill="#d7d2cb" stroke="${ink}" stroke-width="4"/>
      <circle cx="28" cy="-8" r="7" fill="#7ec8e3" stroke="${ink}" stroke-width="3"/>
      <path d="M-8 -48 C-18 -78 8 -84 0 -108" fill="none" stroke="#3f8f55" stroke-width="4" stroke-linecap="round"/>
      <ellipse cx="0" cy="-116" rx="14" ry="10" fill="#7fbf6a" stroke="${ink}" stroke-width="3"/>
    </g>`;
  }
  if (pose.name === "wonder") {
    const lift = Math.round(pose.bob);
    return `<g id="story-prop" transform="translate(860 ${360 - lift})">
      <path d="M0 36 C8 18 8 8 0 -8" fill="none" stroke="#3f8f55" stroke-width="4" stroke-linecap="round"/>
      <ellipse cx="0" cy="-20" rx="16" ry="22" fill="#f4e27a" stroke="${ink}" stroke-width="4"/>
      <ellipse cx="-18" cy="-4" rx="14" ry="8" fill="#f7f3ea" stroke="${ink}" stroke-width="3"/>
      <ellipse cx="18" cy="-4" rx="14" ry="8" fill="#f7f3ea" stroke="${ink}" stroke-width="3"/>
      <ellipse cx="0" cy="2" rx="12" ry="7" fill="#f7f3ea" stroke="${ink}" stroke-width="3"/>
      <circle cx="0" cy="-20" r="5" fill="#fff6dc"/>
    </g>`;
  }
  return "";
}

function arm(id: string, side: "left" | "right", deg: number, identity: CharacterArtIdentity): string {
  const sign = side === "left" ? -1 : 1;
  const sx = sign * 64;
  const sy = -228;
  const hx = sx + sign * 18;
  const hy = sy + 102;
  return `<g id="${id}" transform="rotate(${deg} ${sx} ${sy})">
      <path d="M${sx} ${sy} C ${sx + sign * 8} ${sy + 36}, ${sx + sign * 6} ${sy + 74}, ${hx} ${hy - 8}" fill="none" stroke="${identity.ink}" stroke-width="24" stroke-linecap="round"/>
      <path d="M${sx} ${sy} C ${sx + sign * 8} ${sy + 36}, ${sx + sign * 6} ${sy + 74}, ${hx} ${hy - 8}" fill="none" stroke="${identity.hoodie}" stroke-width="16" stroke-linecap="round"/>
      <circle cx="${hx}" cy="${hy}" r="13" fill="${identity.skin}" stroke="${identity.ink}" stroke-width="4"/>
    </g>`;
}

/**
 * One finished frame of the configured character.
 * Geometry, palette, and motion are original ToonForge art. This file does not
 * reuse the OpenMontage schematic (circle head, GSAP, or its sky/ground colors).
 */
export function renderCharacterSvg(identity: CharacterArtIdentity, pose: PoseState): string {
  const title = xml(identity.displayName);
  const id = xml(identity.id);
  const hairTufts = identity.messyHair
    ? `<path d="M-46 -448 L-64 -492 L-28 -452 Z" fill="${MAX_PALETTE.hairDark}" stroke="${identity.ink}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M-8 -458 L6 -508 L22 -456 Z" fill="${identity.hair}" stroke="${identity.ink}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M24 -450 L46 -498 L52 -446 Z" fill="${identity.hair}" stroke="${identity.ink}" stroke-width="3" stroke-linejoin="round"/>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-label="${title}" data-character-id="${id}" data-display-name="${title}" data-pose="${pose.name}">
  <rect width="1280" height="720" fill="#f6e2c4"/>
  <rect y="500" width="1280" height="220" fill="#e7c9a4"/>
  <g id="workshop" stroke="${identity.ink}" stroke-width="4" stroke-linejoin="round">
    <rect x="860" y="78" width="280" height="200" rx="12" fill="#b7d4e8"/>
    <path d="M1000 78 V278 M860 178 H1140" fill="none"/>
    <rect x="120" y="150" width="220" height="18" rx="4" fill="#8d5a34"/>
    <circle cx="168" cy="122" r="28" fill="#d7b15a"/>
    <circle cx="168" cy="122" r="8" fill="#f6e2c4"/>
    <rect x="250" y="96" width="46" height="62" rx="8" fill="#7fbfa0"/>
    <rect x="180" y="470" width="920" height="26" rx="6" fill="#8d5a34"/>
  </g>
  ${storyProp(pose, identity.ink)}
  <g id="character-${id}" transform="translate(640 ${628 + pose.bob})">
    <ellipse cx="0" cy="8" rx="108" ry="16" fill="#000000" opacity="0.16"/>
    <g id="legs">
      <rect x="-46" y="-86" width="30" height="70" rx="12" fill="#f4efe6" stroke="${identity.ink}" stroke-width="4"/>
      <rect x="16" y="-86" width="30" height="70" rx="12" fill="#f4efe6" stroke="${identity.ink}" stroke-width="4"/>
      <rect x="-52" y="-28" width="42" height="22" rx="8" fill="#3c342e" stroke="${identity.ink}" stroke-width="4"/>
      <rect x="12" y="-28" width="42" height="22" rx="8" fill="#3c342e" stroke="${identity.ink}" stroke-width="4"/>
    </g>
    <g id="shorts">
      <path d="M-50 -156 L50 -156 L44 -78 Q0 -62 -44 -78 Z" fill="${identity.shorts}" stroke="${identity.ink}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M-42 -136 H-18 V-104 H-42 Z" fill="${MAX_PALETTE.shortsPocket}" stroke="${identity.ink}" stroke-width="3"/>
      <path d="M20 -134 H42 V-104 H20 Z" fill="${MAX_PALETTE.shortsPocket}" stroke="${identity.ink}" stroke-width="3"/>
    </g>
    ${arm("arm-left", "left", pose.armLeftDeg, identity)}
    <g id="hoodie">
      <path d="M-62 -250 Q-84 -176 -58 -148 H58 Q84 -176 62 -250 Q34 -268 0 -270 Q-34 -268 -62 -250 Z" fill="${identity.hoodie}" stroke="${identity.ink}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M-24 -176 H24 V-140 Q0 -128 -24 -140 Z" fill="${MAX_PALETTE.hoodieDark}" stroke="${identity.ink}" stroke-width="4" stroke-linejoin="round"/>
      <circle cx="0" cy="-206" r="5" fill="#d7f4ff" stroke="${identity.ink}" stroke-width="3"/>
    </g>
    ${arm("arm-right", "right", pose.armRightDeg, identity)}
    <g id="head-group" transform="rotate(${pose.headTilt} 0 -330)">
      <path id="hood" d="M-96 -348 C-112 -470 0 -512 0 -512 C0 -512 112 -470 96 -348 C70 -300 24 -312 0 -304 C-24 -312 -70 -300 -96 -348 Z" fill="${MAX_PALETTE.hoodieDark}" stroke="${identity.ink}" stroke-width="5" stroke-linejoin="round"/>
      <ellipse cx="-78" cy="-332" rx="14" ry="18" fill="${identity.skin}" stroke="${identity.ink}" stroke-width="4"/>
      <ellipse cx="78" cy="-332" rx="14" ry="18" fill="${identity.skin}" stroke="${identity.ink}" stroke-width="4"/>
      <ellipse id="face" cx="0" cy="-336" rx="74" ry="82" fill="${identity.skin}" stroke="${identity.ink}" stroke-width="5"/>
      <ellipse cx="-24" cy="-312" rx="10" ry="6" fill="#e7a48a" opacity="0.85"/>
      <ellipse cx="26" cy="-312" rx="10" ry="6" fill="#e7a48a" opacity="0.85"/>
      <g id="hair">
        <path d="M-78 -360 C-96 -470 -10 -500 8 -498 C78 -506 102 -430 78 -348 C48 -392 8 -404 -28 -396 C-52 -420 -70 -390 -78 -360 Z" fill="${identity.hair}" stroke="${identity.ink}" stroke-width="4" stroke-linejoin="round"/>
        ${hairTufts}
      </g>
      <g id="goggles">
        <path d="M-84 -392 C-36 -414 40 -414 84 -390" fill="none" stroke="#6b5344" stroke-width="8" stroke-linecap="round"/>
        <ellipse cx="-32" cy="-376" rx="26" ry="16" fill="#d7f4ff" stroke="${identity.ink}" stroke-width="4"/>
        <ellipse cx="32" cy="-376" rx="26" ry="16" fill="#d7f4ff" stroke="${identity.ink}" stroke-width="4"/>
        <path d="M-6 -376 H6" stroke="${identity.ink}" stroke-width="4" stroke-linecap="round"/>
        <ellipse cx="-40" cy="-382" rx="7" ry="3" fill="#ffffff"/>
        <ellipse cx="24" cy="-382" rx="7" ry="3" fill="#ffffff"/>
      </g>
      <path id="brow-left" d="M-48 ${-360 + pose.browLift} Q-30 ${-372 + pose.browLift} -12 ${-358 + pose.browLift}" fill="none" stroke="${MAX_PALETTE.hairDark}" stroke-width="5" stroke-linecap="round"/>
      <path id="brow-right" d="M14 ${-358 + pose.browLift} Q32 ${-374 + pose.browLift} 50 ${-360 + pose.browLift}" fill="none" stroke="${MAX_PALETTE.hairDark}" stroke-width="5" stroke-linecap="round"/>
      ${eye("eye-left", -28, pose)}
      ${eye("eye-right", 30, pose)}
      ${mouth(pose)}
    </g>
  </g>
</svg>
`;
}
