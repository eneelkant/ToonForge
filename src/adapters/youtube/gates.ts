import { existsSync } from "node:fs";
import { ToonForgeError } from "../../core/errors.js";
import {
  detectInvalidStub,
  isProductionMediaKind,
  readMediaKind,
  validateVideo,
} from "../../core/media.js";
import { evaluateProvenanceForPublish, type ProvenanceRecord } from "../../core/provenance.js";
import type { YoutubeUploadRequest } from "./types.js";

export async function assertPublishable(req: YoutubeUploadRequest): Promise<void> {
  if (req.workflowState && req.workflowState !== "READY_TO_PUBLISH") {
    throw new ToonForgeError({
      code: "POLICY_VIOLATION",
      message: `Publishing requires READY_TO_PUBLISH (got ${req.workflowState})`,
      component: "adapters.youtube.gates",
      context: { projectId: req.projectId },
    });
  }
  if (req.qaStatus === "FAIL") {
    throw new ToonForgeError({
      code: "QA_BLOCK",
      message: "Cannot publish when QA status is FAIL",
      component: "adapters.youtube.gates",
    });
  }
  if (req.qaStatus === "WARN" && req.dryRun === false) {
    throw new ToonForgeError({
      code: "QA_BLOCK",
      message: "Cannot live-publish when QA status is WARN",
      component: "adapters.youtube.gates",
    });
  }
  if (req.policyStatus === "FAIL") {
    throw new ToonForgeError({
      code: "POLICY_VIOLATION",
      message: "Cannot publish when policy status is FAIL",
      component: "adapters.youtube.gates",
    });
  }
  if (req.provenance && req.provenance.thirdPartyFootage) {
    throw new ToonForgeError({
      code: "POLICY_VIOLATION",
      message: "Cannot publish projects that reuse third-party footage",
      component: "adapters.youtube.gates",
    });
  }
  if (req.provenance && req.provenance.originalContent === false) {
    throw new ToonForgeError({
      code: "POLICY_VIOLATION",
      message: "Cannot publish without originalContent provenance",
      component: "adapters.youtube.gates",
    });
  }
  if (!existsSync(req.videoPath)) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `Video file missing: ${req.videoPath}`,
      component: "adapters.youtube.gates",
    });
  }
  if (detectInvalidStub(req.videoPath)) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: "Video is an invalid text/stub placeholder — refused",
      component: "adapters.youtube.gates",
    });
  }
  if (req.metadata.thumbnailPath && !existsSync(req.metadata.thumbnailPath)) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `Thumbnail missing: ${req.metadata.thumbnailPath}`,
      component: "adapters.youtube.gates",
    });
  }
  if (req.metadata.thumbnailPath && detectInvalidStub(req.metadata.thumbnailPath)) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: "Thumbnail is a placeholder — refused",
      component: "adapters.youtube.gates",
    });
  }

  const kind = readMediaKind(req.videoPath);
  const dryRun = req.dryRun !== false;

  // Live publish: must be production media + ffprobe-valid.
  if (!dryRun) {
    if (!isProductionMediaKind(kind) && kind !== "unknown") {
      throw new ToonForgeError({
        code: "POLICY_VIOLATION",
        message: `Live publish refuses media kind=${kind} (need reelmimic/provider)`,
        component: "adapters.youtube.gates",
        context: { kind },
      });
    }
    if (kind === "ffmpeg_dev") {
      throw new ToonForgeError({
        code: "POLICY_VIOLATION",
        message: "Live publish refuses ffmpeg_dev fixtures",
        component: "adapters.youtube.gates",
      });
    }
    const video = await validateVideo(req.videoPath, {
      requireAudio: true,
      minDurationSec: 0.5,
      kindHint: kind,
    });
    if (!video.ok) {
      throw new ToonForgeError({
        code: "VALIDATION_FAILED",
        message: `Video failed ffprobe validation: ${video.errors.join("; ")}`,
        component: "adapters.youtube.gates",
      });
    }
    if (req.fullProvenance) {
      const gate = evaluateProvenanceForPublish(req.fullProvenance as ProvenanceRecord);
      if (!gate.ok) {
        throw new ToonForgeError({
          code: "POLICY_VIOLATION",
          message: `Provenance gate failed: ${gate.errors.join("; ")}`,
          component: "adapters.youtube.gates",
        });
      }
    }
  }
}
