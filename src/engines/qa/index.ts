import { existsSync, readFileSync, statSync } from "node:fs";
import {
  readMediaKind,
  validateAudio,
  validateImage,
  validateVideo,
  type MediaKind,
} from "../../core/media.js";
import {
  evaluateProvenanceForPublish,
  type ProvenanceRecord,
} from "../../core/provenance.js";

export type QaVerdict = "PASS" | "FAIL" | "WARN";

export interface QaCheck {
  id: string;
  verdict: QaVerdict;
  message: string;
}

export interface QaReport {
  verdict: QaVerdict;
  checks: QaCheck[];
  mediaKinds?: {
    video?: MediaKind;
    audio?: MediaKind;
    thumbnail?: MediaKind;
  };
}

export async function runQa(input: {
  videoPath?: string;
  audioPath?: string;
  captionsPath?: string;
  thumbnailPath?: string;
  metadata?: { title?: string; description?: string };
  storyComplete?: boolean;
  originalContent?: boolean;
  thirdPartyFootage?: boolean;
  /** When true, ffmpeg_dev fixtures may PASS (dry-run). Live publish must not set this. */
  allowDevFixtures?: boolean;
  /** @deprecated use allowDevFixtures */
  allowStubVideo?: boolean;
  provenance?: ProvenanceRecord | null;
  expectedDurationSec?: number;
  requireAudio?: boolean;
}): Promise<QaReport> {
  const checks: QaCheck[] = [];
  const allowDev = input.allowDevFixtures ?? input.allowStubVideo ?? false;
  const mediaKinds: QaReport["mediaKinds"] = {};

  const fileExists = (id: string, path: string | undefined, required = true) => {
    if (!path) {
      if (required) checks.push({ id, verdict: "FAIL", message: "missing path" });
      return false;
    }
    if (!existsSync(path)) {
      checks.push({ id, verdict: "FAIL", message: `missing file: ${path}` });
      return false;
    }
    const size = statSync(path).size;
    if (size <= 0) {
      checks.push({ id, verdict: "FAIL", message: `empty file: ${path}` });
      return false;
    }
    return true;
  };

  if (input.videoPath && fileExists("file.video", input.videoPath, true)) {
    const kind = readMediaKind(input.videoPath);
    mediaKinds.video = kind;
    const validation = await validateVideo(input.videoPath, {
      requireAudio: input.requireAudio ?? true,
      minDurationSec: 0.5,
      maxDurationSec: input.expectedDurationSec
        ? input.expectedDurationSec * 2 + 5
        : undefined,
      kindHint: kind,
    });
    if (!validation.ok) {
      checks.push({
        id: "media.video",
        verdict: "FAIL",
        message: validation.errors.join("; "),
      });
    } else if (kind === "invalid_stub") {
      checks.push({
        id: "media.video",
        verdict: "FAIL",
        message: "invalid stub video (text placeholder)",
      });
    } else if (kind === "ffmpeg_dev" && !allowDev) {
      checks.push({
        id: "media.video",
        verdict: "FAIL",
        message: "ffmpeg_dev fixture not allowed outside dry-run",
      });
    } else if (kind === "ffmpeg_dev" && allowDev) {
      checks.push({
        id: "media.video",
        verdict: "PASS",
        message: `valid ffprobe media (${validation.durationSec?.toFixed(2)}s, kind=ffmpeg_dev)`,
      });
    } else {
      checks.push({
        id: "media.video",
        verdict: "PASS",
        message: `valid video (${validation.durationSec?.toFixed(2)}s, ${validation.width}x${validation.height}, kind=${kind})`,
      });
    }
  }

  if (input.audioPath && fileExists("file.audio", input.audioPath, false)) {
    const kind = readMediaKind(input.audioPath);
    mediaKinds.audio = kind;
    const validation = await validateAudio(input.audioPath, { kindHint: kind });
    if (!validation.ok || kind === "invalid_stub") {
      checks.push({
        id: "media.audio",
        verdict: allowDev && kind === "ffmpeg_dev" ? "WARN" : "FAIL",
        message: validation.errors.join("; ") || "invalid audio stub",
      });
    } else if (kind === "ffmpeg_dev" && !allowDev) {
      checks.push({
        id: "media.audio",
        verdict: "FAIL",
        message: "ffmpeg_dev audio not allowed for live publish",
      });
    } else {
      checks.push({
        id: "media.audio",
        verdict: "PASS",
        message: `valid audio (${validation.durationSec?.toFixed(2)}s, kind=${kind})`,
      });
    }
  }

  if (fileExists("file.captions", input.captionsPath, true) && input.captionsPath) {
    const body = readFileSync(input.captionsPath, "utf8");
    if (!body.includes("WEBVTT")) {
      checks.push({ id: "file.captions", verdict: "FAIL", message: "captions missing WEBVTT header" });
    } else {
      checks.push({ id: "file.captions", verdict: "PASS", message: "WEBVTT captions present" });
    }
  }

  if (input.thumbnailPath && fileExists("file.thumbnail", input.thumbnailPath, true)) {
    const kind = readMediaKind(input.thumbnailPath);
    mediaKinds.thumbnail = kind;
    const validation = await validateImage(input.thumbnailPath, {
      minWidth: 320,
      minHeight: 180,
      expectedAspect: 16 / 9,
      kindHint: kind,
    });
    if (!validation.ok || kind === "invalid_stub") {
      checks.push({
        id: "media.thumbnail",
        verdict: "FAIL",
        message: validation.errors.join("; ") || "invalid thumbnail",
      });
    } else if (kind === "ffmpeg_dev" && !allowDev) {
      checks.push({
        id: "media.thumbnail",
        verdict: "FAIL",
        message: "ffmpeg_dev thumbnail not allowed for live publish",
      });
    } else {
      checks.push({
        id: "media.thumbnail",
        verdict: "PASS",
        message: `valid image ${validation.width}x${validation.height} (kind=${kind})`,
      });
    }
  }

  if (input.storyComplete === false) {
    checks.push({ id: "content.story", verdict: "FAIL", message: "story incomplete" });
  } else {
    checks.push({ id: "content.story", verdict: "PASS", message: "story marked complete" });
  }

  if (!input.metadata?.title || !input.metadata.description) {
    checks.push({ id: "publish.metadata", verdict: "FAIL", message: "title/description required" });
  } else {
    checks.push({ id: "publish.metadata", verdict: "PASS", message: "metadata present" });
  }

  if (input.thirdPartyFootage) {
    checks.push({ id: "policy.footage", verdict: "FAIL", message: "third-party footage flagged" });
  } else {
    checks.push({ id: "policy.footage", verdict: "PASS", message: "no third-party footage" });
  }

  if (input.originalContent === false) {
    checks.push({ id: "policy.original", verdict: "FAIL", message: "originalContent=false" });
  } else {
    checks.push({ id: "policy.original", verdict: "PASS", message: "original content claimed" });
  }

  if (input.provenance) {
    const liveGate = evaluateProvenanceForPublish(input.provenance, {
      allowDevFixtures: allowDev,
    });
    if (!liveGate.ok) {
      checks.push({
        id: "policy.provenance",
        verdict: "FAIL",
        message: liveGate.errors.join("; "),
      });
    } else {
      checks.push({
        id: "policy.provenance",
        verdict: "PASS",
        message: allowDev ? "provenance complete (dry-run allows ffmpeg_dev)" : "provenance complete",
      });
    }
  }

  const hasFail = checks.some((c) => c.verdict === "FAIL");
  const hasWarn = checks.some((c) => c.verdict === "WARN");
  return {
    verdict: hasFail ? "FAIL" : hasWarn ? "WARN" : "PASS",
    checks,
    mediaKinds,
  };
}
