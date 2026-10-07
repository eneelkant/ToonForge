import { existsSync, readFileSync, statSync } from "node:fs";

export type QaVerdict = "PASS" | "FAIL" | "WARN";

export interface QaCheck {
  id: string;
  verdict: QaVerdict;
  message: string;
}

export interface QaReport {
  verdict: QaVerdict;
  checks: QaCheck[];
}

export function runQa(input: {
  videoPath?: string;
  audioPath?: string;
  captionsPath?: string;
  thumbnailPath?: string;
  metadata?: { title?: string; description?: string };
  storyComplete?: boolean;
  originalContent?: boolean;
  thirdPartyFootage?: boolean;
  allowStubVideo?: boolean;
}): QaReport {
  const checks: QaCheck[] = [];

  const fileCheck = (id: string, path: string | undefined, required = true) => {
    if (!path) {
      if (required) checks.push({ id, verdict: "FAIL", message: "missing path" });
      return;
    }
    if (!existsSync(path)) {
      checks.push({ id, verdict: "FAIL", message: `missing file: ${path}` });
      return;
    }
    const size = statSync(path).size;
    if (size <= 0) checks.push({ id, verdict: "FAIL", message: `empty file: ${path}` });
    else checks.push({ id, verdict: "PASS", message: `ok (${size} bytes)` });
  };

  fileCheck("file.video", input.videoPath, true);
  fileCheck("file.audio", input.audioPath, false);
  fileCheck("file.captions", input.captionsPath, true);
  fileCheck("file.thumbnail", input.thumbnailPath, true);

  if (input.videoPath && existsSync(input.videoPath) && !input.allowStubVideo) {
    const head = readFileSync(input.videoPath).subarray(0, 32).toString("utf8");
    if (head.includes("TOONFORGE_LOCAL_RENDER")) {
      checks.push({
        id: "content.stub_video",
        verdict: "WARN",
        message: "Local stub render detected; replace with ReelMimic output before real publish",
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

  const hasFail = checks.some((c) => c.verdict === "FAIL");
  const hasWarn = checks.some((c) => c.verdict === "WARN");
  return {
    verdict: hasFail ? "FAIL" : hasWarn ? "WARN" : "PASS",
    checks,
  };
}
