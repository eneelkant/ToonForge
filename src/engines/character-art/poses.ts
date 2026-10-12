import type { StoryboardShot } from "../storyboard/index.js";

export const POSE_NAMES = ["idle", "blink", "look", "gesture", "wonder"] as const;
export type PoseName = (typeof POSE_NAMES)[number];

export interface PoseState {
  name: PoseName;
  bob: number;
  headTilt: number;
  pupilX: number;
  pupilY: number;
  eyeScaleY: number;
  eyeRy: number;
  browLift: number;
  mouth: "smile" | "open" | "soft";
  armLeftDeg: number;
  armRightDeg: number;
}

const PRESETS: Record<PoseName, Omit<PoseState, "bob">> = {
  idle: {
    name: "idle",
    headTilt: 0,
    pupilX: 0,
    pupilY: 0,
    eyeScaleY: 1,
    eyeRy: 16,
    browLift: 0,
    mouth: "smile",
    armLeftDeg: 12,
    armRightDeg: -12,
  },
  blink: {
    name: "blink",
    headTilt: 0,
    pupilX: 0,
    pupilY: 0,
    eyeScaleY: 0.12,
    eyeRy: 16,
    browLift: 2,
    mouth: "soft",
    armLeftDeg: 12,
    armRightDeg: -12,
  },
  look: {
    name: "look",
    headTilt: -8,
    pupilX: 7,
    pupilY: -2,
    eyeScaleY: 1,
    eyeRy: 16,
    browLift: -2,
    mouth: "soft",
    armLeftDeg: 16,
    armRightDeg: -8,
  },
  gesture: {
    name: "gesture",
    headTilt: 5,
    pupilX: 2,
    pupilY: -1,
    eyeScaleY: 1,
    eyeRy: 16,
    browLift: -1,
    mouth: "smile",
    armLeftDeg: 18,
    armRightDeg: -78,
  },
  wonder: {
    name: "wonder",
    headTilt: -4,
    pupilX: 0,
    pupilY: -5,
    eyeScaleY: 1.16,
    eyeRy: 20,
    browLift: -8,
    mouth: "open",
    armLeftDeg: 24,
    armRightDeg: -62,
  },
};

export function poseForShot(shot: Pick<StoryboardShot, "visual" | "narration" | "dialogue">, index: number): PoseName {
  const text = `${shot.visual} ${shot.narration} ${shot.dialogue}`.toLowerCase();
  if (/\bwonder\b|\breact\b|\bamazed\b|\bcelebrate\b/.test(text)) return "wonder";
  if (/\bdiscover\b|\blook\b|\bnotice\b|\bfinds?\b|\bglow/.test(text)) return "look";
  if (/\bgesture\b|\bwave\b|\binvent\b|\bfits?\b|\blifts?\b|\btinker/.test(text)) return "gesture";
  if (/\bblink\b/.test(text)) return "blink";
  const cycle: PoseName[] = ["look", "gesture", "wonder"];
  return cycle[index % cycle.length] ?? "idle";
}

export function poseState(name: PoseName, frame: number, fps: number): PoseState {
  const preset = PRESETS[name];
  const t = frame / Math.max(1, fps);
  const bob = Math.sin((t * Math.PI * 2) / 0.85) * (name === "wonder" ? 7 : 4);
  const blinkPeriod = Math.max(8, Math.round(fps * 2.6));
  const blinking = name === "blink" || frame % blinkPeriod < 2;
  return {
    ...preset,
    bob: Math.round(bob * 10) / 10,
    eyeScaleY: blinking ? 0.12 : preset.eyeScaleY,
  };
}

export function shotAtTime<T extends { duration_seconds: number }>(
  shots: T[],
  timeSec: number,
): { shot: T; index: number } {
  if (shots.length === 0) {
    throw new Error("storyboard has no shots");
  }
  let cursor = 0;
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index]!;
    const end = cursor + shot.duration_seconds;
    if (timeSec < end || index === shots.length - 1) return { shot, index };
    cursor = end;
  }
  return { shot: shots[shots.length - 1]!, index: shots.length - 1 };
}
