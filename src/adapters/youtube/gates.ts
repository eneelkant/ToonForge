import { existsSync } from "node:fs";
import { ToonForgeError } from "../../core/errors.js";
import type { YoutubeUploadRequest } from "./types.js";

export function assertPublishable(req: YoutubeUploadRequest): void {
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
  if (req.metadata.thumbnailPath && !existsSync(req.metadata.thumbnailPath)) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `Thumbnail missing: ${req.metadata.thumbnailPath}`,
      component: "adapters.youtube.gates",
    });
  }
}
