import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { ToonForgeError } from "../../core/errors.js";
import type { ReferenceAnalysisReport } from "./types.js";

export function normalizeAnalysisReport(raw: unknown, meta: {
  stub: boolean;
  sourcePath?: string | null;
  sourceUrl?: string | null;
  notes?: string[];
}): ReferenceAnalysisReport {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const shots = Array.isArray(obj.shots) ? obj.shots : Array.isArray(obj.scenes) ? obj.scenes : undefined;
  return {
    stub: meta.stub,
    source_path: meta.sourcePath ?? null,
    source_url: meta.sourceUrl ?? null,
    analyzed_at: new Date().toISOString(),
    duration: typeof obj.duration === "number" ? obj.duration : undefined,
    shot_count:
      typeof obj.shot_count === "number"
        ? obj.shot_count
        : typeof obj.shotCount === "number"
          ? obj.shotCount
          : shots?.length,
    pacing: obj.pacing ?? obj.tempo ?? undefined,
    transitions: obj.transitions,
    framing: obj.framing,
    camera_movement: obj.camera_movement ?? obj.camera,
    colors: obj.colors ?? obj.color,
    bpm: typeof obj.bpm === "number" ? obj.bpm : null,
    rhythm: obj.rhythm ?? obj.beats,
    style: obj.style ?? obj.visual_style,
    notes: meta.notes ?? [],
    raw: obj,
  };
}

export async function runAnalyzePy(opts: {
  reelmimicRoot: string;
  sourcePath?: string;
  sourceUrl?: string;
  outDir: string;
  timeoutMs: number;
}): Promise<ReferenceAnalysisReport> {
  const script = resolve(opts.reelmimicRoot, ".claude/skills/video-clone/scripts/analyze.py");
  if (!existsSync(script)) {
    throw new ToonForgeError({
      code: "ADAPTER_UNAVAILABLE",
      message: `ReelMimic analyze.py not found at ${script}`,
      component: "adapters.reelmimic.analyze",
    });
  }
  const source = opts.sourcePath || opts.sourceUrl;
  if (!source) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: "analyzeReference requires sourcePath or sourceUrl",
      component: "adapters.reelmimic.analyze",
    });
  }
  mkdirSync(opts.outDir, { recursive: true });

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("python3", [script, source, "--out", opts.outDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new ToonForgeError({
          code: "UPSTREAM_ERROR",
          message: "ReelMimic analyze.py timed out",
          component: "adapters.reelmimic.analyze",
          retryable: true,
        }),
      );
    }, opts.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new ToonForgeError({
          code: "UPSTREAM_ERROR",
          message: error.message,
          component: "adapters.reelmimic.analyze",
          cause: error,
          retryable: true,
        }),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else {
        reject(
          new ToonForgeError({
            code: "UPSTREAM_ERROR",
            message: `analyze.py exited ${code}: ${stderr.slice(-2000)}`,
            component: "adapters.reelmimic.analyze",
          }),
        );
      }
    });
  });

  const reportPath = join(opts.outDir, "report.json");
  if (!existsSync(reportPath)) {
    throw new ToonForgeError({
      code: "UPSTREAM_ERROR",
      message: "analyze.py completed but report.json is missing",
      component: "adapters.reelmimic.analyze",
    });
  }
  const raw = JSON.parse(readFileSync(reportPath, "utf8"));
  return normalizeAnalysisReport(raw, {
    stub: false,
    sourcePath: opts.sourcePath,
    sourceUrl: opts.sourceUrl,
    notes: ["Produced by ReelMimic analyze.py"],
  });
}

export function writeAnalysisReport(outDir: string, report: ReferenceAnalysisReport): string {
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, "reference-analysis.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return reportPath;
}
