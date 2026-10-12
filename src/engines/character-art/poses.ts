import type { StoryboardShot } from "../storyboard/index.js";
import { textMouthOpen } from "./mouth.js";

export const POSE_NAMES = ["idle", "blink", "look", "gesture", "wonder", "point", "read", "examine", "walk", "explain", "react"] as const;
export type PoseName = (typeof POSE_NAMES)[number];
export type Interaction = "none" | "reach" | "fit" | "wave" | "point" | "read" | "examine" | "walk" | "explain" | "react";
export const EXPRESSION_NAMES = ["happy", "curious", "excited", "surprised", "thoughtful", "worried", "confident"] as const;
export type ExpressionName = (typeof EXPRESSION_NAMES)[number];
export const VIEW_NAMES = ["front", "three-quarter", "side", "back"] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

export interface Point {
  x: number;
  y: number;
}

export interface PoseState {
  name: PoseName;
  interaction: Interaction;
  bob: number;
  headTilt: number;
  pupilX: number;
  pupilY: number;
  eyeScaleY: number;
  eyeRy: number;
  browLift: number;
  mouthOpen: number;
  /** How the mouth value was chosen. Amplitude envelope is not phoneme alignment. */
  mouthSync: "text-pulses" | "amplitude-envelope";
  progress: number;
  held: boolean;
  seated: boolean;
  wristLeft: Point;
  wristRight: Point;
  elbowLeft: Point;
  elbowRight: Point;
  shoulderLeft: Point;
  shoulderRight: Point;
  /** Prop anchor in the same local space as the wrists (character origin at the feet). */
  prop: Point;
  /** Vertical shift of the forehead goggles. Negative moves them up; they stay on the head. */
  goggleLift: number;
  /** Seedling anchor while the engine lifts it. Null until that action has started. */
  seedlingY: number | null;
  expression: ExpressionName;
  view: ViewName;
  /** Leg swing for a walk cycle. Zero keeps a standing pose. */
  legSwing: number;
}

const SHOULDER_L: Point = { x: -62, y: -232 };
const SHOULDER_R: Point = { x: 62, y: -232 };
const REST_ELBOW_L: Point = { x: -78, y: -168 };
const REST_ELBOW_R: Point = { x: 78, y: -168 };
const REST_WRIST_L: Point = { x: -92, y: -112 };
const REST_WRIST_R: Point = { x: 96, y: -112 };
const GEAR_ON_BENCH: Point = { x: 168, y: -176 };
const GEAR_IN_HAND: Point = { x: 154, y: -168 };
const ENGINE_SOCKET: Point = { x: 228, y: -186 };
const FLOWER_START: Point = { x: 220, y: -168 };
const FLOWER_END: Point = { x: 210, y: -340 };

function matchPose(text: string): PoseName | undefined {
  const rules: Array<{ pattern: RegExp; pose: PoseName }> = [
    { pattern: /\bwalk/, pose: "walk" },
    { pattern: /\bpoint|\bmap\b/, pose: "point" },
    { pattern: /\bread|\bscroll|\bbook\b/, pose: "read" },
    { pattern: /\bexamin|\bartifact\b/, pose: "examine" },
    { pattern: /\bexplain|\btakeaway|\bconclusion\b/, pose: "explain" },
    { pattern: /\breact\b|\bworried\b|\bsurpris/, pose: "react" },
    { pattern: /\bwonder\b|\bamazed\b|\bcelebrate\b|\bwave/, pose: "wonder" },
    { pattern: /\bdiscover\b|\blook\b|\bnotice\b|\bfinds?\b|\bglow/, pose: "look" },
    { pattern: /\bgesture\b|\binvent\b|\bfits?\b|\blifts?\b|\btinker/, pose: "gesture" },
    { pattern: /\bblink\b/, pose: "blink" },
  ];
  let best: { index: number; pose: PoseName } | undefined;
  for (const rule of rules) {
    const match = rule.pattern.exec(text);
    if (!match || match.index < 0) continue;
    if (!best || match.index < best.index) best = { index: match.index, pose: rule.pose };
  }
  return best?.pose;
}

/**
 * The shot action decides the pose. Narration can mention a map or a walk
 * without changing the picture the storyboard asked for.
 */
export function poseForShot(shot: Pick<StoryboardShot, "visual" | "narration" | "dialogue">, index: number): PoseName {
  const fromAction = matchPose(shot.visual.toLowerCase());
  if (fromAction) return fromAction;
  const fromSpeech = matchPose(`${shot.narration} ${shot.dialogue}`.toLowerCase());
  if (fromSpeech) return fromSpeech;
  const cycle: PoseName[] = ["look", "gesture", "wonder"];
  return cycle[index % cycle.length] ?? "idle";
}

/** A word in the shot action can select an expression. Otherwise the pose supplies one. */
export function expressionForShot(shot: Pick<StoryboardShot, "visual">, pose: PoseName): ExpressionName {
  const text = shot.visual.toLowerCase();
  if (/\bworried\b|\bconcern/.test(text)) return "worried";
  if (/\bexcited\b|\bamaz/.test(text)) return "excited";
  if (/\bsurpris/.test(text)) return "surprised";
  if (/\bthoughtful\b|\bthink/.test(text)) return "thoughtful";
  if (/\bconfident\b/.test(text)) return "confident";
  if (/\bcurious\b/.test(text)) return "curious";
  if (/\bhappy\b|\bcheer/.test(text)) return "happy";
  return expressionForPose(pose);
}

export function viewForCamera(camera: string): ViewName {
  const text = camera.toLowerCase();
  if (/\bback\b/.test(text)) return "back";
  if (/\bside\b|\bprofile\b/.test(text)) return "side";
  if (/three/.test(text)) return "three-quarter";
  return "front";
}

export function expressionForPose(name: PoseName): ExpressionName {
  if (name === "point" || name === "look" || name === "examine") return "curious";
  if (name === "read") return "thoughtful";
  if (name === "walk") return "happy";
  if (name === "explain" || name === "gesture") return "confident";
  if (name === "wonder") return "excited";
  if (name === "react") return "surprised";
  return "happy";
}

export function interactionForPose(name: PoseName): Interaction {
  if (name === "look") return "reach";
  if (name === "gesture") return "fit";
  if (name === "wonder") return "wave";
  if (name === "point" || name === "read" || name === "examine" || name === "walk" || name === "explain" || name === "react") {
    return name;
  }
  return "none";
}

export function poseState(
  name: PoseName,
  frame: number,
  fps: number,
  timing?: {
    localTimeSec?: number;
    shotDurationSec?: number;
    mouthOpen?: number;
    narration?: string;
    view?: ViewName;
    expression?: ExpressionName;
  },
): PoseState {
  const safeFps = Math.max(1, fps);
  const shotDuration = Math.max(0.2, timing?.shotDurationSec ?? 3);
  const local = timing?.localTimeSec ?? frame / safeFps;
  const progress = clamp(local / shotDuration, 0, 1);
  const bob = Math.round(Math.sin((local * Math.PI * 2) / 0.85) * (name === "wonder" ? 7 : 4) * 10) / 10;
  const blinkPeriod = Math.max(8, Math.round(safeFps * 2.6));
  const blinking = name === "blink" || frame % blinkPeriod < 2;
  const interaction = interactionForPose(name);
  const face = faceFor(name, blinking);
  const joints = jointsFor(interaction, progress, local);
  const mouthOpen =
    timing?.mouthOpen != null
      ? clamp(timing.mouthOpen, 0, 1)
      : textMouthOpen(timing?.narration ?? "Max looks and reacts", local);
  return {
    name,
    interaction,
    bob,
    ...face,
    mouthOpen: Math.round(mouthOpen * 1000) / 1000,
    mouthSync: timing?.mouthOpen != null ? "amplitude-envelope" : "text-pulses",
    progress: Math.round(progress * 1000) / 1000,
    held: joints.held,
    seated: joints.seated,
    wristLeft: joints.wristLeft,
    wristRight: joints.wristRight,
    elbowLeft: joints.elbowLeft,
    elbowRight: joints.elbowRight,
    shoulderLeft: SHOULDER_L,
    shoulderRight: SHOULDER_R,
    prop: joints.prop,
    goggleLift: interaction === "reach" ? Math.round(-smooth(progress) * 18) : 0,
    seedlingY: seedlingLift(interaction, progress),
    expression: timing?.expression ?? expressionForPose(name),
    view: timing?.view ?? "front",
    legSwing: interaction === "walk" ? Math.round(Math.sin(local * Math.PI * 2 * 1.4) * 18) : 0,
  };
}

function seedlingLift(interaction: Interaction, progress: number): number | null {
  if (interaction !== "fit") return null;
  const sprout = smooth(Math.max(0, (progress - 0.45) / 0.55));
  if (sprout <= 0.02) return null;
  return Math.round((-168 - 110 * sprout) * 10) / 10;
}

function faceFor(name: PoseName, blinking: boolean): Pick<PoseState, "headTilt" | "pupilX" | "pupilY" | "eyeScaleY" | "eyeRy" | "browLift"> {
  const base = {
    idle: { headTilt: 0, pupilX: 0, pupilY: 0, eyeScaleY: 1, eyeRy: 16, browLift: 0 },
    blink: { headTilt: 0, pupilX: 0, pupilY: 0, eyeScaleY: 0.12, eyeRy: 16, browLift: 2 },
    look: { headTilt: -8, pupilX: 7, pupilY: -2, eyeScaleY: 1, eyeRy: 16, browLift: -2 },
    gesture: { headTilt: 4, pupilX: 3, pupilY: -1, eyeScaleY: 1, eyeRy: 16, browLift: -1 },
    wonder: { headTilt: -5, pupilX: 1, pupilY: -5, eyeScaleY: 1.16, eyeRy: 20, browLift: -8 },
    point: { headTilt: -6, pupilX: 8, pupilY: -2, eyeScaleY: 1, eyeRy: 16, browLift: -4 },
    read: { headTilt: 10, pupilX: 0, pupilY: 4, eyeScaleY: 0.9, eyeRy: 15, browLift: 2 },
    examine: { headTilt: 8, pupilX: 4, pupilY: 3, eyeScaleY: 1, eyeRy: 16, browLift: -2 },
    walk: { headTilt: -2, pupilX: 2, pupilY: 0, eyeScaleY: 1, eyeRy: 16, browLift: -1 },
    explain: { headTilt: -3, pupilX: 1, pupilY: -1, eyeScaleY: 1, eyeRy: 16, browLift: -3 },
    react: { headTilt: -8, pupilX: 0, pupilY: -4, eyeScaleY: 1.2, eyeRy: 20, browLift: -10 },
  }[name];
  return { ...base, eyeScaleY: blinking ? 0.12 : base.eyeScaleY };
}

function jointsFor(interaction: Interaction, progress: number, local: number): {
  elbowLeft: Point;
  elbowRight: Point;
  wristLeft: Point;
  wristRight: Point;
  prop: Point;
  held: boolean;
  seated: boolean;
} {
  if (interaction === "reach") {
    const reach = smooth(progress);
    const wristRight = lerp(REST_WRIST_R, { x: GEAR_ON_BENCH.x - 8, y: GEAR_ON_BENCH.y + 6 }, reach);
    const elbowRight = lerp(REST_ELBOW_R, { x: 118, y: -196 }, reach);
    const held = reach > 0.72;
    return {
      elbowLeft: REST_ELBOW_L,
      elbowRight,
      wristLeft: REST_WRIST_L,
      wristRight,
      prop: held ? { x: wristRight.x + 16, y: wristRight.y - 8 } : GEAR_ON_BENCH,
      held,
      seated: false,
    };
  }
  if (interaction === "fit") {
    const slide = smooth(progress);
    const prop = lerp(GEAR_IN_HAND, ENGINE_SOCKET, slide);
    const wristRight = { x: prop.x - 18, y: prop.y + 10 };
    const elbowRight = lerp({ x: 112, y: -188 }, { x: 150, y: -200 }, slide);
    const wristLeft = lerp(REST_WRIST_L, { x: ENGINE_SOCKET.x - 70, y: ENGINE_SOCKET.y + 16 }, slide);
    return {
      elbowLeft: lerp(REST_ELBOW_L, { x: -20, y: -190 }, slide),
      elbowRight,
      wristLeft,
      wristRight,
      prop,
      held: slide < 0.92,
      seated: slide >= 0.92,
    };
  }
  if (interaction === "wave") {
    const lift = smooth(Math.min(1, progress * 1.4));
    const wave = Math.sin(local * Math.PI * 2 * 1.6);
    const elbowRight = lerp(REST_ELBOW_R, { x: 96, y: -286 }, lift);
    const wristRight = lerp(REST_WRIST_R, { x: 78 + wave * 26, y: -348 }, lift);
    const prop = lerp(FLOWER_START, FLOWER_END, smooth(progress));
    const wristLeft = lerp(REST_WRIST_L, { x: prop.x - 78, y: prop.y + 24 }, lift * 0.45);
    return {
      elbowLeft: lerp(REST_ELBOW_L, { x: -36, y: -210 }, lift * 0.45),
      elbowRight,
      wristLeft,
      wristRight,
      prop,
      held: false,
      seated: false,
    };
  }
  if (interaction === "point" || interaction === "explain" || interaction === "react") {
    const lift = interaction === "react" ? 1 : smooth(Math.min(1, progress * 1.3));
    const raised = interaction === "react" ? { x: 70, y: -330 } : interaction === "point" ? { x: 168, y: -236 } : { x: 110, y: -300 };
    return {
      elbowLeft: interaction === "react" ? { x: -90, y: -250 } : REST_ELBOW_L,
      elbowRight: lerp(REST_ELBOW_R, { x: 120, y: -250 }, lift),
      wristLeft: interaction === "react" ? lerp(REST_WRIST_L, { x: -80, y: -320 }, lift) : REST_WRIST_L,
      wristRight: lerp(REST_WRIST_R, raised, lift),
      prop: raised,
      held: false,
      seated: false,
    };
  }
  if (interaction === "read" || interaction === "examine") {
    const focus = interaction === "read" ? { x: 36, y: -168 } : { x: 48, y: -140 };
    return {
      elbowLeft: { x: -36, y: -190 },
      elbowRight: { x: 70, y: -188 },
      wristLeft: { x: focus.x - 36, y: focus.y + 8 },
      wristRight: { x: focus.x + 10, y: focus.y + 6 },
      prop: focus,
      held: true,
      seated: false,
    };
  }
  if (interaction === "walk") {
    const swing = Math.sin(local * Math.PI * 2 * 1.4);
    return {
      elbowLeft: { x: REST_ELBOW_L.x, y: REST_ELBOW_L.y + swing * 10 },
      elbowRight: { x: REST_ELBOW_R.x, y: REST_ELBOW_R.y - swing * 10 },
      wristLeft: { x: REST_WRIST_L.x + swing * 16, y: REST_WRIST_L.y },
      wristRight: { x: REST_WRIST_R.x - swing * 16, y: REST_WRIST_R.y },
      prop: { x: 0, y: 0 },
      held: false,
      seated: false,
    };
  }
  return {
    elbowLeft: REST_ELBOW_L,
    elbowRight: REST_ELBOW_R,
    wristLeft: REST_WRIST_L,
    wristRight: REST_WRIST_R,
    prop: { x: 0, y: 0 },
    held: false,
    seated: false,
  };
}

export function shotAtTime<T extends { duration_seconds: number }>(
  shots: T[],
  timeSec: number,
): { shot: T; index: number; localTimeSec: number; shotDurationSec: number } {
  if (shots.length === 0) {
    throw new Error("storyboard has no shots");
  }
  let cursor = 0;
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index]!;
    const duration = shot.duration_seconds;
    const end = cursor + duration;
    if (timeSec < end || index === shots.length - 1) {
      return { shot, index, localTimeSec: Math.max(0, timeSec - cursor), shotDurationSec: duration };
    }
    cursor = end;
  }
  const last = shots[shots.length - 1]!;
  return { shot: last, index: shots.length - 1, localTimeSec: 0, shotDurationSec: last.duration_seconds };
}

function lerp(a: Point, b: Point, t: number): Point {
  return {
    x: Math.round((a.x + (b.x - a.x) * t) * 10) / 10,
    y: Math.round((a.y + (b.y - a.y) * t) * 10) / 10,
  };
}

function smooth(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
