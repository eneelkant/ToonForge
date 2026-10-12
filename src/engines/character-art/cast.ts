import type { CharacterArtIdentity } from "./identity.js";
import { MILA_PALETTE, MILO_MONKEY_PALETTE } from "./identity.js";
import type { Point, PoseState, ViewName } from "./poses.js";

/**
 * Original ToonForge drawings of Mila and Milo.
 * No uploaded character sheet was present in the workspace, so these shapes follow
 * the locked written features: Mila's purple hair, backward pink cap, stripes,
 * backpack, purple trousers, and yellow boots; Milo's golden fur, tan face,
 * brown eyes, ears, tuft, and curled tail, with no clothes.
 * Mouth openness is the narration amplitude envelope or the letter-pulse fallback.
 * It is not phoneme lip-sync.
 */

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function capsule(from: Point, to: Point, radius: number, fill: string, ink: string): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * radius;
  const ny = (dx / len) * radius;
  return `<path d="M ${from.x + nx} ${from.y + ny} L ${to.x + nx} ${to.y + ny} A ${radius} ${radius} 0 0 1 ${to.x - nx} ${to.y - ny} L ${from.x - nx} ${from.y - ny} A ${radius} ${radius} 0 0 1 ${from.x + nx} ${from.y + ny} Z" fill="${fill}" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>`;
}

function hand(id: string, wrist: Point, elbow: Point, fill: string, ink: string): string {
  const angle = (Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x) * 180) / Math.PI + 90;
  return `<g id="${id}" transform="translate(${wrist.x} ${wrist.y}) rotate(${angle.toFixed(1)})">
      <ellipse cx="-7" cy="-5" rx="3" ry="6" fill="${fill}" stroke="${ink}" stroke-width="2"/>
      <ellipse cx="0" cy="-7" rx="3.1" ry="6.4" fill="${fill}" stroke="${ink}" stroke-width="2"/>
      <ellipse cx="7" cy="-5" rx="3" ry="5.6" fill="${fill}" stroke="${ink}" stroke-width="2"/>
      <ellipse cx="0" cy="3" rx="11" ry="9" fill="${fill}" stroke="${ink}" stroke-width="2.5"/>
      <ellipse cx="11" cy="2" rx="3.2" ry="5" transform="rotate(40 11 2)" fill="${fill}" stroke="${ink}" stroke-width="2"/>
    </g>`;
}

function arm(id: string, handId: string, shoulder: Point, elbow: Point, wrist: Point, fill: string, skin: string, ink: string): string {
  return `<g id="${id}">
      ${capsule(shoulder, elbow, 11, fill, ink)}
      <circle cx="${elbow.x}" cy="${elbow.y}" r="7" fill="${skin}" stroke="${ink}" stroke-width="2.5"/>
      ${capsule(elbow, wrist, 8, fill, ink)}
      <circle cx="${wrist.x}" cy="${wrist.y}" r="5.5" fill="${skin}" stroke="${ink}" stroke-width="2.5"/>
      ${hand(handId, wrist, elbow, skin, ink)}
    </g>`;
}

function mouthOpen(pose: PoseState): number {
  const bias: Record<PoseState["expression"], number> = {
    happy: 0.04,
    curious: 0.08,
    excited: 0.16,
    surprised: 0.28,
    thoughtful: 0,
    worried: 0.02,
    confident: 0.06,
  };
  return Math.max(0, Math.min(1, pose.mouthOpen + bias[pose.expression]));
}

function mouth(id: string, pose: PoseState, y: number): string {
  const open = mouthOpen(pose);
  const hidden = pose.view === "back" ? ` opacity="0"` : "";
  if (open < 0.18) {
    const curve = pose.expression === "worried" ? 8 : -10;
    return `<path id="${id}"${hidden} data-mouth-open="${open.toFixed(3)}" d="M-16 ${y} Q0 ${y + curve} 16 ${y}" fill="none" stroke="#6e2430" stroke-width="4" stroke-linecap="round"/>`;
  }
  const ry = 4 + open * 14;
  return `<ellipse id="${id}"${hidden} data-mouth-open="${open.toFixed(3)}" cx="0" cy="${y + ry * 0.2}" rx="${10 + open * 6}" ry="${ry}" fill="#6e2430" stroke="#2a2118" stroke-width="3"/>`;
}

function viewTransform(view: ViewName): string {
  if (view === "three-quarter") return "scale(0.88 1) translate(10 0)";
  if (view === "side") return "scale(0.58 1)";
  if (view === "back") return "scale(0.94 1)";
  return "";
}

function brows(prefix: string, pose: PoseState, y: number): string {
  if (pose.view === "back") return "";
  const lift = pose.browLift;
  const worried = pose.expression === "worried" ? 8 : 0;
  return `<path id="${prefix}-brow-left" d="M-34 ${y + lift + worried} Q-18 ${y - 12 + lift} -4 ${y + lift}" fill="none" stroke="#4a3028" stroke-width="4" stroke-linecap="round"/>
      <path id="${prefix}-brow-right" d="M4 ${y + lift} Q20 ${y - 14 + lift} 34 ${y + lift + worried}" fill="none" stroke="#4a3028" stroke-width="4" stroke-linecap="round"/>`;
}

function eyes(prefix: string, pose: PoseState, y: number, fill: string): string {
  const hidden = pose.view === "back" ? ` opacity="0"` : "";
  const scale = pose.eyeScaleY;
  return `<g id="${prefix}-eye-left"${hidden} transform="translate(-22 ${y}) scale(1 ${scale})">
        <ellipse rx="12" ry="14" fill="#fffaf4" stroke="#2a2118" stroke-width="3"/>
        <circle cx="${pose.pupilX}" cy="${pose.pupilY}" r="5" fill="${fill}"/>
      </g>
      <g id="${prefix}-eye-right"${hidden} transform="translate(22 ${y}) scale(1 ${scale})">
        <ellipse rx="12" ry="14" fill="#fffaf4" stroke="#2a2118" stroke-width="3"/>
        <circle cx="${pose.pupilX}" cy="${pose.pupilY}" r="5" fill="${fill}"/>
      </g>`;
}

function heldProp(pose: PoseState): string {
  if (pose.interaction === "read") {
    return `<g id="prop-scroll" transform="translate(${pose.prop.x} ${pose.prop.y})"><rect x="-28" y="-16" width="56" height="32" rx="4" fill="#f7f1df" stroke="#2a2118" stroke-width="3"/><path d="M-16 -4 H16 M-16 6 H10" stroke="#8d5a34" stroke-width="2" stroke-linecap="round"/></g>`;
  }
  if (pose.interaction === "examine") {
    return `<g id="prop-artifact" transform="translate(${pose.prop.x} ${pose.prop.y})"><path d="M-14 12 L0 -14 L14 12 Z" fill="#d7c4a3" stroke="#2a2118" stroke-width="3"/></g>`;
  }
  return "";
}

function legs(prefix: string, pose: PoseState, fill: string, shoe: string, ink: string, shoeName = "boot"): string {
  const swing = pose.legSwing;
  return `<g id="${prefix}-legs">
      <rect x="${-28 + swing}" y="-78" width="22" height="62" rx="10" fill="${fill}" stroke="${ink}" stroke-width="3"/>
      <rect x="${8 - swing}" y="-78" width="22" height="62" rx="10" fill="${fill}" stroke="${ink}" stroke-width="3"/>
      <rect id="${prefix}-${shoeName}-left" x="${-34 + swing}" y="-24" width="32" height="18" rx="6" fill="${shoe}" stroke="${ink}" stroke-width="3"/>
      <rect id="${prefix}-${shoeName}-right" x="${6 - swing}" y="-24" width="32" height="18" rx="6" fill="${shoe}" stroke="${ink}" stroke-width="3"/>
    </g>`;
}

export function renderMila(identity: CharacterArtIdentity, pose: PoseState): string {
  const ink = identity.ink;
  const skin = MILA_PALETTE.skin;
  const showFace = pose.view !== "back";
  return `<g id="character-mila" data-character-id="mila" data-display-name="Mila" data-view="${pose.view}" data-expression="${pose.expression}" data-pose="${pose.name}" data-mouth-sync="${pose.mouthSync}" transform="${viewTransform(pose.view)} rotate(${pose.headTilt * 0.15} 0 -120)">
      ${legs("mila", pose, MILA_PALETTE.trousers, MILA_PALETTE.boots, ink)}
      <path id="mila-trousers" d="M-34 -150 L34 -150 L40 -78 L-40 -78 Z" fill="${MILA_PALETTE.trousers}" stroke="${ink}" stroke-width="4"/>
      ${arm("mila-arm-left", "mila-hand-left", pose.shoulderLeft, pose.elbowLeft, pose.wristLeft, MILA_PALETTE.stripe, skin, ink)}
      <path id="mila-shirt" d="M-48 -250 Q-58 -170 -40 -148 H40 Q58 -170 48 -250 Q20 -268 0 -270 Q-20 -268 -48 -250 Z" fill="${MILA_PALETTE.shirt}" stroke="${ink}" stroke-width="4"/>
      <path d="M-36 -230 H-8 V-160 H-36 Z" fill="${MILA_PALETTE.stripe}"/>
      <path d="M8 -230 H36 V-160 H8 Z" fill="${MILA_PALETTE.stripe}"/>
      ${arm("mila-arm-right", "mila-hand-right", pose.shoulderRight, pose.elbowRight, pose.wristRight, MILA_PALETTE.stripe, skin, ink)}
      <g id="mila-backpack" transform="${pose.view === "back" ? "translate(0 -20)" : "translate(-8 -40)"}">
        <rect x="-34" y="-230" width="68" height="78" rx="14" fill="${MILA_PALETTE.backpack}" stroke="${ink}" stroke-width="4"/>
        <path d="M-20 -230 V-268 M20 -230 V-268" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>
      </g>
      <g id="mila-head" transform="rotate(${pose.headTilt} 0 -320)">
        ${showFace ? `<ellipse id="mila-face" cx="0" cy="-330" rx="58" ry="66" fill="${skin}" stroke="${ink}" stroke-width="4"/>` : `<ellipse cx="0" cy="-330" rx="58" ry="66" fill="${MILA_PALETTE.hair}" stroke="${ink}" stroke-width="4"/>`}
        <path id="mila-hair" d="M-62 -340 C-78 -460 -8 -490 4 -488 C70 -500 86 -420 62 -332 C40 -390 8 -400 -20 -392 C-46 -410 -54 -370 -62 -340 Z" fill="${MILA_PALETTE.hair}" stroke="${ink}" stroke-width="3"/>
        <path d="M-40 -430 L-54 -470 L-24 -436 Z" fill="${MILA_PALETTE.hairDark}"/>
        <path d="M8 -448 L20 -492 L34 -444 Z" fill="${MILA_PALETTE.hair}"/>
        <g id="mila-cap" transform="rotate(18 0 -400)">
          <ellipse cx="8" cy="-404" rx="62" ry="22" fill="${MILA_PALETTE.cap}" stroke="${ink}" stroke-width="3"/>
          <path d="M-54 -404 H70 Q86 -404 96 -392" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>
          <rect x="28" y="-418" width="22" height="12" rx="3" fill="#f7d0e0" stroke="${ink}" stroke-width="2"/>
        </g>
        ${eyes("mila", pose, -336, MILA_PALETTE.eyes)}
        ${brows("mila", pose, -358)}
        ${mouth("mila-mouth", pose, -300)}
        ${heldProp(pose)}
      </g>
    </g>`;
}

export function renderMilo(identity: CharacterArtIdentity, pose: PoseState): string {
  const ink = identity.ink;
  const fur = MILO_MONKEY_PALETTE.fur;
  const face = MILO_MONKEY_PALETTE.face;
  const showFace = pose.view !== "back";
  const tailCurl = 20 + Math.sin(pose.progress * Math.PI * 2) * 8;
  return `<g id="character-milo" data-character-id="milo-monkey" data-display-name="Milo" data-view="${pose.view}" data-expression="${pose.expression}" data-pose="${pose.name}" data-mouth-sync="${pose.mouthSync}" transform="${viewTransform(pose.view)}">
      <path id="milo-tail" d="M-20 -90 C-70 -40 -90 ${tailCurl} -40 ${tailCurl + 30} C10 ${tailCurl + 48} -10 ${tailCurl - 10} -46 ${tailCurl + 8}" fill="none" stroke="${fur}" stroke-width="14" stroke-linecap="round"/>
      <path d="M-20 -90 C-70 -40 -90 ${tailCurl} -40 ${tailCurl + 30}" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>
      ${legs("milo", pose, fur, fur, ink, "foot")}
      <ellipse id="milo-belly" cx="0" cy="-150" rx="46" ry="58" fill="${MILO_MONKEY_PALETTE.belly}" stroke="${ink}" stroke-width="3"/>
      <ellipse id="milo-fur" cx="0" cy="-168" rx="58" ry="70" fill="${fur}" stroke="${ink}" stroke-width="4"/>
      <ellipse cx="0" cy="-150" rx="28" ry="36" fill="${MILO_MONKEY_PALETTE.belly}"/>
      ${arm("milo-arm-left", "milo-hand-left", pose.shoulderLeft, pose.elbowLeft, pose.wristLeft, fur, face, ink)}
      ${arm("milo-arm-right", "milo-hand-right", pose.shoulderRight, pose.elbowRight, pose.wristRight, fur, face, ink)}
      <g id="milo-head" transform="rotate(${pose.headTilt} 0 -320)">
        <ellipse id="milo-ear-left" cx="-62" cy="-330" rx="22" ry="28" fill="${fur}" stroke="${ink}" stroke-width="3"/>
        <ellipse cx="-62" cy="-330" rx="12" ry="16" fill="${face}"/>
        <ellipse id="milo-ear-right" cx="62" cy="-330" rx="22" ry="28" fill="${fur}" stroke="${ink}" stroke-width="3"/>
        <ellipse cx="62" cy="-330" rx="12" ry="16" fill="${face}"/>
        <ellipse cx="0" cy="-324" rx="54" ry="58" fill="${fur}" stroke="${ink}" stroke-width="4"/>
        <ellipse id="milo-face" cx="0" cy="-316" rx="36" ry="40" fill="${face}" stroke="${ink}" stroke-width="3"${showFace ? "" : ` opacity="0"`}/>
        <path id="milo-tuft" d="M-8 -378 L4 -430 L18 -374 Z" fill="${MILO_MONKEY_PALETTE.tuft}" stroke="${ink}" stroke-width="2"/>
        <ellipse id="milo-muzzle" cx="0" cy="-292" rx="16" ry="12" fill="${face}" stroke="${ink}" stroke-width="2"${showFace ? "" : ` opacity="0"`}/>
        ${eyes("milo", pose, -328, MILO_MONKEY_PALETTE.eyes)}
        ${brows("milo", pose, -350)}
        ${mouth("milo-mouth", pose, -292)}
        ${heldProp(pose)}
      </g>
    </g>`;
}

function background(kind: string): string {
  if (kind === "harbor") {
    return `<rect width="1280" height="720" fill="#d7ecf7"/>
      <rect y="430" width="1280" height="290" fill="#7eb6d8"/>
      <path d="M180 470 Q260 430 340 470 Q420 510 500 470" fill="none" stroke="#f7fbff" stroke-width="6"/>
      <path d="M620 500 L760 430 L900 500 Z" fill="#f4efe6" stroke="#2a2118" stroke-width="4"/>
      <rect x="700" y="390" width="8" height="50" fill="#6b5344"/>`;
  }
  if (kind === "map") {
    return `<rect width="1280" height="720" fill="#f3e2c4"/>
      <rect x="180" y="120" width="920" height="460" rx="18" fill="#e7c9a4" stroke="#2a2118" stroke-width="6"/>
      <path d="M280 220 C420 180 520 300 680 240 C820 190 900 280 1020 230" fill="none" stroke="#2f6b4f" stroke-width="8" stroke-linecap="round"/>
      <circle cx="460" cy="250" r="8" fill="#d64550"/>`;
  }
  if (kind === "scroll") {
    return `<rect width="1280" height="720" fill="#f6e7cf"/>
      <rect x="360" y="250" width="560" height="220" rx="16" fill="#f7f1df" stroke="#2a2118" stroke-width="4"/>
      <path d="M400 300 H880 M400 340 H820 M400 380 H860" stroke="#8d5a34" stroke-width="4" stroke-linecap="round"/>`;
  }
  if (kind === "artifact") {
    return `<rect width="1280" height="720" fill="#efe2cf"/>
      <rect x="520" y="430" width="240" height="36" rx="8" fill="#8d5a34"/>
      <path d="M590 430 L620 360 H690 L710 430 Z" fill="#d7c4a3" stroke="#2a2118" stroke-width="4"/>`;
  }
  return `<rect width="1280" height="720" fill="#f4e6cf"/>
    <rect x="80" y="80" width="240" height="520" fill="#6b3f2a"/>
    <rect x="110" y="120" width="180" height="28" fill="#e7c9a4"/>
    <rect x="110" y="170" width="180" height="28" fill="#e7c9a4"/>
    <rect x="110" y="220" width="180" height="28" fill="#e7c9a4"/>
    <rect x="960" y="80" width="240" height="520" fill="#6b3f2a"/>
    <rect x="990" y="120" width="180" height="28" fill="#e7c9a4"/>
    <rect x="990" y="170" width="180" height="28" fill="#e7c9a4"/>`;
}

export function backgroundForVisual(visual: string): string {
  const text = visual.toLowerCase();
  if (/harbor|ship|dock|fire/.test(text)) return "harbor";
  if (/map|point/.test(text)) return "map";
  if (/scroll|book|read/.test(text)) return "scroll";
  if (/artifact|fragment|examin/.test(text)) return "artifact";
  return "library";
}

export function renderCastSvg(input: {
  identities: CharacterArtIdentity[];
  poses: PoseState[];
  visual: string;
  title?: string;
  onScreenText?: string;
}): string {
  const kind = backgroundForVisual(input.visual);
  const placed = input.identities.map((identity, index) => {
    const pose = input.poses[index] ?? input.poses[0];
    if (!pose) return "";
    const x = input.identities.length === 1 ? 640 : index === 0 ? 430 : 860;
    const body = identity.kind === "milo-monkey" ? renderMilo(identity, pose) : renderMila(identity, pose);
    return `<g transform="translate(${x} ${640 + pose.bob}) scale(0.78)">${body}</g>`;
  });
  const title = input.title ? `<text x="640" y="78" text-anchor="middle" font-family="Palatino, Georgia, serif" font-size="42" fill="#2a2118">${xml(input.title)}</text>` : "";
  const onScreen = input.onScreenText
    ? `<text x="640" y="688" text-anchor="middle" font-family="Palatino, Georgia, serif" font-size="28" fill="#2a2118">${xml(input.onScreenText)}</text>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" data-character-id="${xml(input.identities[0]?.id ?? "cast")}" data-display-name="${xml(input.identities[0]?.displayName ?? "Cast")}" data-background="${kind}">
  ${background(kind)}
  ${title}
  ${placed.join("\n")}
  ${onScreen}
</svg>`;
}

export function renderTitleCard(identities: CharacterArtIdentity[], title: string): string {
  const poses = identities.map(() => ({
    name: "explain" as const,
    interaction: "explain" as const,
    bob: 0,
    headTilt: -3,
    pupilX: 1,
    pupilY: -1,
    eyeScaleY: 1,
    eyeRy: 16,
    browLift: -3,
    mouthOpen: 0.2,
    mouthSync: "text-pulses" as const,
    progress: 0.4,
    held: false,
    seated: false,
    wristLeft: { x: -92, y: -112 },
    wristRight: { x: 120, y: -280 },
    elbowLeft: { x: -78, y: -168 },
    elbowRight: { x: 110, y: -230 },
    shoulderLeft: { x: -62, y: -232 },
    shoulderRight: { x: 62, y: -232 },
    prop: { x: 120, y: -280 },
    goggleLift: 0,
    seedlingY: null,
    expression: "confident" as const,
    view: "front" as const,
    legSwing: 0,
  }));
  return renderCastSvg({ identities, poses, visual: "library shelves and a map", title });
}
