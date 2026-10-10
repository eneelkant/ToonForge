import { mkdirSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import type { Storyboard } from "../storyboard/index.js";
import type { OriginalStory } from "../story/index.js";
import type { CharacterRecord } from "../../characters/types.js";
import { ToonForgeError } from "../../core/errors.js";
import { assertNotKilled, loadRuntimeConfig } from "../../core/config.js";
import { assertWithinBudget } from "../../core/budget.js";
import {
  generateDevVideo,
  type MediaKind,
  validateVideo,
  writeMediaSidecar,
} from "../../core/media.js";
import type { ReelMimicAdapter } from "../../adapters/reelmimic/types.js";
import type { OpenMontageAdapter } from "../../adapters/openmontage/types.js";
import { rootLogger } from "../../core/logging.js";
import type { PipelineMode } from "../reference/index.js";

const log = rootLogger.child("engines.production");

export interface ProductionResult {
  projectId: string;
  videoPath: string;
  /** @deprecated use kind — true only for invalid stubs */
  stub: boolean;
  kind: MediaKind;
  detail: string;
  mode: PipelineMode;
  reelmimicProjectId?: string;
  openmontage?: {
    versions: Record<string, string>;
    retryCount: number;
    artifactPaths: string[];
    estimatedCostUsd: number;
    actualCostUsd: number;
    approval: string;
    startedAt: string;
    endedAt: string;
  };
}

export interface ProduceCartoonInput {
  projectId: string;
  projectDir: string;
  story: OriginalStory;
  storyboard: Storyboard;
  reelmimic?: ReelMimicAdapter | null;
  openmontage?: OpenMontageAdapter | null;
  characters?: CharacterRecord[];
  /** Quoted cost checked before an OpenMontage render. Local tools quote 0. */
  estimatedCostUsd?: number;
  /**
   * Explicit pipeline mode.
   * - offline_fixture: FFmpeg valid clip allowed
   * - reelmimic: must use ReelMimic; never silently fall back to FFmpeg
   * - openmontage: must use OpenMontage; never silently fall back
   */
  mode?: PipelineMode;
  /** @deprecated Prefer mode. When mode=reelmimic, fixtures are refused. */
  allowDevFixture?: boolean;
  durationSec?: number;
  referencePath?: string;
  referenceUrl?: string;
}

/**
 * Produce cartoon video.
 * ReelMimic mode never silently downgrades to FFmpeg because dryRun was true.
 */
export async function produceCartoon(input: ProduceCartoonInput): Promise<ProductionResult> {
  const outDir = join(input.projectDir, "out");
  mkdirSync(outDir, { recursive: true });
  const videoPath = join(outDir, "video.mp4");
  const mode: PipelineMode =
    input.mode ?? (input.allowDevFixture === false ? "reelmimic" : "offline_fixture");

  if (mode === "openmontage") {
    return produceWithOpenMontage(input, outDir, videoPath);
  }

  if (mode === "reelmimic") {
    if (!input.reelmimic) {
      throw new ToonForgeError({
        code: "ADAPTER_UNAVAILABLE",
        message: "ReelMimic production mode requires an enabled ReelMimic adapter",
        component: "engines.production",
      });
    }
    if (!input.referencePath && !input.referenceUrl) {
      throw new ToonForgeError({
        code: "VALIDATION_FAILED",
        message: "ReelMimic production requires referencePath or referenceUrl",
        component: "engines.production",
      });
    }

    const health = await input.reelmimic.health();
    if (!health.ok) {
      throw new ToonForgeError({
        code: "ADAPTER_UNAVAILABLE",
        message: `ReelMimic unhealthy: ${health.detail}`,
        component: "engines.production",
        context: { health },
      });
    }

    try {
      const created = await input.reelmimic.createProject({
        brief: `${input.story.title}\n\n${input.story.logline}\n\n${input.story.synopsis}`,
        title: input.story.title,
        lang: "en",
        referencePath: input.referencePath,
        referenceUrl: input.referenceUrl,
      });
      const artifacts = await input.reelmimic.discoverArtifacts(created.projectId);
      if (artifacts.failed) {
        throw new ToonForgeError({
          code: "UPSTREAM_ERROR",
          message: `ReelMimic project failed: ${artifacts.detail}`,
          component: "engines.production",
          context: { projectId: created.projectId },
        });
      }
      if (!artifacts.videoPath || !existsSync(artifacts.videoPath)) {
        throw new ToonForgeError({
          code: "UPSTREAM_ERROR",
          message: `ReelMimic video not ready: ${artifacts.detail}`,
          component: "engines.production",
          context: { projectId: created.projectId, stage: artifacts.detail },
          retryable: true,
        });
      }
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
        notes: [`reelmimicProjectId=${created.projectId}`, "pipelineMode=reelmimic"],
      });
      writeProductionMeta(outDir, input, {
        kind: "reelmimic",
        mode,
        reelmimicProjectId: created.projectId,
      });
      log.info("production.reelmimic", { projectId: input.projectId, videoPath });
      return {
        projectId: input.projectId,
        videoPath,
        stub: false,
        kind: "reelmimic",
        mode,
        detail: "ReelMimic artifact copied and validated",
        reelmimicProjectId: created.projectId,
      };
    } catch (error) {
      // Never fall back to FFmpeg in reelmimic mode (including dry-run).
      if (error instanceof ToonForgeError) throw error;
      throw new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: error instanceof Error ? error.message : String(error),
        component: "engines.production",
        cause: error,
      });
    }
  }

  // offline_fixture mode only
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
      "TEST/DEV ONLY — valid container for offline_fixture mode",
      "Not permitted for live YouTube publish",
      "pipelineMode=offline_fixture",
    ],
  });
  writeProductionMeta(outDir, input, { kind: "ffmpeg_dev", mode });
  log.info("production.ffmpeg_dev", { projectId: input.projectId, videoPath, durationSec, mode });
  return {
    projectId: input.projectId,
    videoPath,
    stub: false,
    kind: "ffmpeg_dev",
    mode,
    detail: "FFmpeg offline fixture (valid media; not for live publish)",
  };
}

/** @deprecated Use produceCartoon with mode=offline_fixture */
export async function produceLocalCartoon(input: {
  projectId: string;
  projectDir: string;
  story: OriginalStory;
  storyboard: Storyboard;
  reelmimicProjectId?: string;
}): Promise<ProductionResult> {
  return produceCartoon({
    ...input,
    mode: "offline_fixture",
  });
}

async function produceWithOpenMontage(
  input: ProduceCartoonInput,
  outDir: string,
  videoPath: string,
): Promise<ProductionResult> {
  const config = loadRuntimeConfig();
  assertNotKilled(config);
  assertWithinBudget(
    config,
    { dailySpentUsd: 0, videoSpentUsd: 0 },
    input.estimatedCostUsd ?? 0,
  );
  if (!input.openmontage) {
    throw new ToonForgeError({
      code: "ADAPTER_UNAVAILABLE",
      message: "OpenMontage production mode requires an enabled OpenMontage adapter",
      component: "engines.production",
    });
  }
  if (!input.characters?.length) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: "OpenMontage production requires the configured ToonForge characters",
      component: "engines.production",
    });
  }
  const health = await input.openmontage.health();
  if (health.status !== "ready") {
    throw new ToonForgeError({
      code: health.status === "invalid_configuration" ? "CONFIG_INVALID" : "ADAPTER_UNAVAILABLE",
      message: `OpenMontage ${health.status}: ${health.detail}`,
      component: "engines.production",
      context: { health },
    });
  }
  const startedAt = new Date().toISOString();
  const workspace = join(input.projectDir, "openmontage");
  mkdirSync(workspace, { recursive: true });
  let rendered;
  try {
    rendered = await input.openmontage.renderCharacterAnimation({
      workspace,
      characters: input.characters,
      storyboard: input.storyboard,
      brief: `${input.story.title}\n\n${input.story.logline}\n\n${input.story.synopsis}`,
      durationSeconds: Math.min(8, Math.max(2, input.durationSec ?? 3)),
      fps: 12,
    });
  } catch (error) {
    if (error instanceof ToonForgeError) throw error;
    throw new ToonForgeError({
      code: "UPSTREAM_ERROR",
      message: error instanceof Error ? error.message : String(error),
      component: "engines.production",
      cause: error,
    });
  }
  if (!rendered.videoPath || !existsSync(rendered.videoPath)) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: "OpenMontage finished without a video artifact",
      component: "engines.production",
    });
  }
  copyFileSync(rendered.videoPath, videoPath);
  const validation = await validateVideo(videoPath, {
    requireAudio: false,
    minDurationSec: 0.5,
    kindHint: "openmontage",
  });
  if (!validation.ok) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `OpenMontage output failed validation: ${validation.errors.join("; ")}`,
      component: "engines.production",
    });
  }
  const endedAt = new Date().toISOString();
  writeMediaSidecar(videoPath, {
    kind: "openmontage",
    provider: "openmontage",
    notes: [
      "pipelineMode=openmontage",
      `versions=${JSON.stringify(rendered.versions)}`,
      "agentPipelineApproval=not_invoked",
      "reference footage not reused",
    ],
  });
  const openmontage = {
    versions: rendered.versions,
    retryCount: rendered.retryCount,
    artifactPaths: rendered.artifactPaths,
    estimatedCostUsd: rendered.estimatedCostUsd,
    actualCostUsd: rendered.actualCostUsd,
    approval: rendered.approval.agentPipeline,
    startedAt,
    endedAt,
  };
  writeProductionMeta(outDir, input, { kind: "openmontage", mode: "openmontage", openmontage });
  log.info("production.openmontage", {
    projectId: input.projectId,
    videoPath,
    versions: rendered.versions,
    retryCount: rendered.retryCount,
    actualCostUsd: rendered.actualCostUsd,
  });
  return {
    projectId: input.projectId,
    videoPath,
    stub: false,
    kind: "openmontage",
    mode: "openmontage",
    detail: "OpenMontage character animation validated",
    openmontage,
  };
}

function writeProductionMeta(
  outDir: string,
  input: ProduceCartoonInput,
  extra: {
    kind: MediaKind;
    mode: PipelineMode;
    reelmimicProjectId?: string;
    openmontage?: ProductionResult["openmontage"];
  },
): void {
  writeFileSync(
    join(outDir, "production.json"),
    JSON.stringify(
      {
        projectId: input.projectId,
        storyId: input.story.story_id,
        storyboardId: input.storyboard.storyboard_id,
        reelmimicProjectId: extra.reelmimicProjectId ?? null,
        openmontage: extra.openmontage ?? null,
        kind: extra.kind,
        mode: extra.mode,
        backend: extra.mode,
        stub: extra.kind === "invalid_stub",
        referencePath: input.referencePath ?? null,
        referenceUrl: input.referenceUrl ?? null,
        analysisOnly: true,
        thirdPartyFootageReused: false,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
