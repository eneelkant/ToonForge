import { ToonForgeError } from "../../core/errors.js";

/** Playwright preview contract. Production renders do not use this ceiling. */
export const PREVIEW_DURATION_MIN_SEC = 2;
export const PREVIEW_DURATION_MAX_SEC = 8;

/** Runaway guard for a full storyboard. This is not the preview cap. */
export const PRODUCTION_DURATION_MIN_SEC = 2;
export const PRODUCTION_DURATION_MAX_SEC = 120;

export function storyboardDurationSec(storyboard: { shots: Array<{ duration_seconds: number }> }): number {
  return storyboard.shots.reduce((sum, shot) => sum + (Number.isFinite(shot.duration_seconds) ? shot.duration_seconds : 0), 0);
}

/**
 * Preview renders stay inside 2–8 seconds.
 * A production render uses the storyboard shot sum when the board has timing.
 * An explicit request is used only when the board has no shots.
 */
export function resolveRenderDuration(input: {
  requestedSec?: number;
  storyboardSec: number;
  preview?: boolean;
}): number {
  const storyboard = Number.isFinite(input.storyboardSec) ? input.storyboardSec : 0;
  if (input.preview) {
    const base = storyboard > 0 ? storyboard : (input.requestedSec ?? 3);
    return Math.min(PREVIEW_DURATION_MAX_SEC, Math.max(PREVIEW_DURATION_MIN_SEC, base));
  }
  if (storyboard > 0) {
    assertProductionBounds(storyboard, "Storyboard");
    return storyboard;
  }
  assertProductionBounds(input.requestedSec ?? 3, "Requested duration");
  return Math.max(PRODUCTION_DURATION_MIN_SEC, input.requestedSec ?? 3);
}

function assertProductionBounds(seconds: number, label: string): void {
  if (seconds > PRODUCTION_DURATION_MAX_SEC) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `${label} is ${seconds}s, above the ${PRODUCTION_DURATION_MAX_SEC}s production guard. Shorten the storyboard. This guard is separate from the ${PREVIEW_DURATION_MAX_SEC}s preview cap.`,
      component: "engines.production",
      context: { seconds, previewMax: PREVIEW_DURATION_MAX_SEC, productionMax: PRODUCTION_DURATION_MAX_SEC },
    });
  }
  if (seconds < PRODUCTION_DURATION_MIN_SEC) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `${label} is ${seconds}s. Production renders need at least ${PRODUCTION_DURATION_MIN_SEC} seconds of storyboard timing.`,
      component: "engines.production",
      context: { seconds },
    });
  }
}
