import { mkdirSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import type { Storyboard } from "../storyboard/index.js";
import type { OriginalStory } from "../story/index.js";
import { ToonForgeError } from "../../core/errors.js";
import {
  generateDevVideo,
  type MediaKind,
  validateVideo,
  writeMediaSidecar,
} from "../../core/media.js";
import type { ReelMimicAdapter } from "../../adapters/reelmimic/types.js";
import { rootLogger } from "../../core/logging.js";

const log = rootLogger.child("engines.production");

export interface ProductionResult {
  projectId: string;
  videoPath: string;
  /** @deprecated use kind — true only for invalid stubs */
  stub: boolean;
  kind: MediaKind;
  detail: string;
  reelmimicProjectId?: string;
}

export interface ProduceCartoonInput {
  projectId: string;
  projectDir: string;
  story: OriginalStory;
  storyboard: Storyboard;
  /** Prefer ReelMimic when adapter is ready; otherwise FFmpeg dev fixture. */
  reelmimic?: ReelMimicAdapter | null;
  /** Allow FFmpeg local fixture when ReelMimic unavailable (dry-run / CI). */
  allowDevFixture?: boolean;
  durationSec?: number;
  referencePath?: string;
  referenceUrl?: string;
}

/**
 * Produce cartoon video.
 * - ReelMimic when enabled and healthy → kind=reelmimic
 * - Otherwise FFmpeg valid short clip → kind=ffmpeg_dev (dev/dry-run only)
 * Never writes text-placeholder .mp4 files.
 */
export async function produceCartoon(input: ProduceCartoonInput): Promise<ProductionResult> {
  const outDir = join(input.projectDir, "out");
  mkdirSync(outDir, { recursive: true });
  const videoPath = join(outDir, "video.mp4");
  const allowDev = input.allowDevFixture ?? true;

  if (input.reelmimic) {
    const health = await input.reelmimic.health();
    if (health.ok) {
      try {
        const created = await input.reelmimic.createProject({
          brief: `${input.story.title}\n\n${input.story.logline}\n\n${input.story.synopsis}`,
          title: input.story.title,
          lang: "en",
          referencePath: input.referencePath,
          referenceUrl: input.referenceUrl,
        });
        const artifacts = await input.reelmimic.discoverArtifacts(created.projectId);
        if (artifacts.videoPath && existsSync(artifacts.videoPath)) {
          copyFileSync(artifacts.videoPath, videoPath);
          const validation = await validateVideo(videoPath, {
            requireAudio: false,
            kindHint: "reelmimic",
          });
          if (!validation.ok) {
            throw new ToonForgeError({
              code: "VALIDATION_FAILED",
              message: `ReelMimic output failed validation: ${validation.errors.join("; ")}`,
              component: "engines.production",
            });
          }
          writeMediaSidecar(videoPath, {
            kind: "reelmimic",
            provider: "reelmimic",
            notes: [`reelmimicProjectId=${created.projectId}`],
          });
          writeProductionMeta(outDir, input, {
            kind: "reelmimic",
            reelmimicProjectId: created.projectId,
          });
          log.info("production.reelmimic", { projectId: input.projectId, videoPath });
          return {
            projectId: input.projectId,
            videoPath,
            stub: false,
            kind: "reelmimic",
            detail: "ReelMimic artifact copied and validated",
            reelmimicProjectId: created.projectId,
          };
        }
        log.warn("production.reelmimic_no_video_yet", {
          projectId: created.projectId,
          detail: artifacts.detail,
        });
        // Async production not finished — fall through to fixture only if allowed.
      } catch (error) {
        log.warn("production.reelmimic_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!allowDev) {
          throw error instanceof ToonForgeError
            ? error
            : new ToonForgeError({
                code: "UPSTREAM_ERROR",
                message: error instanceof Error ? error.message : String(error),
                component: "engines.production",
                cause: error,
              });
        }
      }
    }
  }

  if (!allowDev) {
    throw new ToonForgeError({
      code: "ADAPTER_UNAVAILABLE",
      message: "ReelMimic unavailable and allowDevFixture=false",
      component: "engines.production",
    });
  }

  const durationSec = Math.min(8, Math.max(2, input.durationSec ?? 3));
  await generateDevVideo({
    outPath: videoPath,
    durationSec,
    width: 640,
    height: 360,
    fps: 24,
    withAudio: true,
    label: input.story.title.slice(0, 24),
  });
  const validation = await validateVideo(videoPath, {
    requireAudio: true,
    minDurationSec: 0.5,
    kindHint: "ffmpeg_dev",
  });
  if (!validation.ok) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `Dev fixture video invalid: ${validation.errors.join("; ")}`,
      component: "engines.production",
    });
  }
  writeMediaSidecar(videoPath, {
    kind: "ffmpeg_dev",
    provider: "ffmpeg",
    notes: [
      "TEST/DEV ONLY — valid container for dry-run and CI",
      "Not permitted for live YouTube publish",
    ],
  });
  writeProductionMeta(outDir, input, { kind: "ffmpeg_dev" });
  log.info("production.ffmpeg_dev", { projectId: input.projectId, videoPath, durationSec });
  return {
    projectId: input.projectId,
    videoPath,
    stub: false,
    kind: "ffmpeg_dev",
    detail: "FFmpeg development fixture (valid media; not for live publish)",
  };
}

/** @deprecated Use produceCartoon — kept for MCP/compat; always generates valid FFmpeg media. */
export async function produceLocalCartoon(input: {
  projectId: string;
  projectDir: string;
  story: OriginalStory;
  storyboard: Storyboard;
  reelmimicProjectId?: string;
}): Promise<ProductionResult> {
  return produceCartoon({
    ...input,
    allowDevFixture: true,
  });
}

function writeProductionMeta(
  outDir: string,
  input: ProduceCartoonInput,
  extra: { kind: MediaKind; reelmimicProjectId?: string },
): void {
  writeFileSync(
    join(outDir, "production.json"),
    JSON.stringify(
      {
        projectId: input.projectId,
        storyId: input.story.story_id,
        storyboardId: input.storyboard.storyboard_id,
        reelmimicProjectId: extra.reelmimicProjectId ?? null,
        kind: extra.kind,
        stub: extra.kind === "invalid_stub",
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
