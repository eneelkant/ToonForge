import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { ToonForgeError } from "../../core/errors.js";
import { normalizeAnalysisReport } from "../../adapters/reelmimic/analyze.js";
import type { ReferenceAnalysisReport } from "../../adapters/reelmimic/types.js";
import type { TrendCandidate } from "../trend/index.js";
import { topicFingerprint } from "../trend/index.js";

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"]);

export type PipelineMode = "offline_fixture" | "reelmimic" | "openmontage";

/**
 * Resolve execution mode.
 * - offline_fixture: deterministic CI/dev; never pretends to be live production
 * - reelmimic: real ReelMimic path; requires a valid video reference; no silent FFmpeg downgrade
 * - openmontage: explicit OpenMontage character-animation path; no silent downgrade
 *
 * Enabling OpenMontage does not change the default. An omitted channel backend keeps
 * the historical choice: ReelMimic when enabled, otherwise the offline fixture.
 * An explicit mode or channel backend is never replaced.
 */
export function resolvePipelineMode(opts: {
  reelmimicEnabled: boolean;
  openmontageEnabled?: boolean;
  /** Explicit override from CLI/MCP. */
  mode?: PipelineMode;
  /** Channel `production_backend`, when set. */
  channelBackend?: PipelineMode;
  /** Legacy opt-in for offline fixtures when ReelMimic disabled. */
  preferOfflineFixture?: boolean;
}): PipelineMode {
  if (opts.mode) return opts.mode;
  if (opts.channelBackend) return opts.channelBackend;
  if (opts.reelmimicEnabled) return "reelmimic";
  if (opts.preferOfflineFixture !== false) return "offline_fixture";
  return "reelmimic";
}

export interface ResolvedReference {
  mode: PipelineMode;
  /** True when this is analysis-only (no footage reuse). */
  analysisOnly: true;
  referencePath?: string;
  referenceUrl?: string;
  /** Offline structured format report (no ReelMimic call). */
  offlineFormatReport?: ReferenceAnalysisReport;
  designation: "offline_fixture" | "openmontage_format" | "configured_path" | "trend_url" | "trend_path" | "override";
  licenseStatus: "unknown" | "authorized" | "not_applicable";
  notes: string[];
}

function isLikelyVideoPath(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return VIDEO_EXTS.has(ext);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Resolve a reference for format analysis / production.
 * Never invents URLs. Never returns a .txt placeholder as a video reference.
 */
export function resolveReference(opts: {
  mode: PipelineMode;
  trend: TrendCandidate;
  projectDir: string;
  referencePathOverride?: string;
  referenceUrlOverride?: string;
}): ResolvedReference {
  const notes: string[] = [
    "Reference used for format/technique analysis only — not for footage reuse",
  ];

  const pathOverride = opts.referencePathOverride?.trim();
  const urlOverride = opts.referenceUrlOverride?.trim();

  if (pathOverride) {
    if (!existsSync(pathOverride)) {
      throw new ToonForgeError({
        code: "VALIDATION_FAILED",
        message: `referencePath does not exist: ${pathOverride}`,
        component: "engines.reference",
      });
    }
    if (!isLikelyVideoPath(pathOverride)) {
      throw new ToonForgeError({
        code: "VALIDATION_FAILED",
        message: `referencePath must be a video file (got ${extname(pathOverride) || "no extension"})`,
        component: "engines.reference",
        context: { path: pathOverride },
      });
    }
    return {
      mode: opts.mode,
      analysisOnly: true,
      referencePath: pathOverride,
      designation: "override",
      licenseStatus: "unknown",
      notes: [...notes, "Caller-supplied local video path", "license/authorization unknown — flagged"],
    };
  }

  if (urlOverride) {
    if (!isHttpUrl(urlOverride)) {
      throw new ToonForgeError({
        code: "VALIDATION_FAILED",
        message: "referenceUrl must be http(s)",
        component: "engines.reference",
      });
    }
    return {
      mode: opts.mode,
      analysisOnly: true,
      referenceUrl: urlOverride,
      designation: "override",
      licenseStatus: "unknown",
      notes: [...notes, "Caller-supplied URL", "license/authorization unknown — flagged"],
    };
  }

  if (opts.trend.reference_path) {
    if (!existsSync(opts.trend.reference_path) || !isLikelyVideoPath(opts.trend.reference_path)) {
      throw new ToonForgeError({
        code: "VALIDATION_FAILED",
        message: `Trend reference_path is not a usable video: ${opts.trend.reference_path}`,
        component: "engines.reference",
      });
    }
    return {
      mode: opts.mode,
      analysisOnly: true,
      referencePath: opts.trend.reference_path,
      designation: "trend_path",
      licenseStatus: "unknown",
      notes: [...notes, "Trend-provided local path", "license/authorization unknown — flagged"],
    };
  }

  if (opts.trend.source_url && isHttpUrl(opts.trend.source_url)) {
    return {
      mode: opts.mode,
      analysisOnly: true,
      referenceUrl: opts.trend.source_url,
      designation: "trend_url",
      licenseStatus: "unknown",
      notes: [...notes, "Trend-provided source_url", "license/authorization unknown — flagged"],
    };
  }

  const fromReferences = opts.trend.references.find((r) => isHttpUrl(r) || (existsSync(r) && isLikelyVideoPath(r)));
  if (fromReferences) {
    if (isHttpUrl(fromReferences)) {
      return {
        mode: opts.mode,
        analysisOnly: true,
        referenceUrl: fromReferences,
        designation: "trend_url",
        licenseStatus: "unknown",
        notes: [...notes, "Trend references[] URL", "license/authorization unknown — flagged"],
      };
    }
    return {
      mode: opts.mode,
      analysisOnly: true,
      referencePath: fromReferences,
      designation: "trend_path",
      licenseStatus: "unknown",
      notes: [...notes, "Trend references[] path", "license/authorization unknown — flagged"],
    };
  }

  if (opts.mode === "offline_fixture" || opts.mode === "openmontage") {
    const report = buildOfflineFormatAnalysis(opts.trend);
    const analysisDir = join(opts.projectDir, "analysis");
    mkdirSync(analysisDir, { recursive: true });
    const reportPath = join(analysisDir, "reference-analysis.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    const openmontage = opts.mode === "openmontage";
    return {
      mode: opts.mode,
      analysisOnly: true,
      offlineFormatReport: report,
      designation: openmontage ? "openmontage_format" : "offline_fixture",
      licenseStatus: "not_applicable",
      notes: [
        ...notes,
        openmontage
          ? "OPENMONTAGE: format fixture only — reference footage is not downloaded or embedded"
          : "OFFLINE FIXTURE: structured format analysis only — not a real third-party video",
        "No .txt placeholder passed to ReelMimic or OpenMontage",
        reportPath,
      ],
    };
  }

  throw new ToonForgeError({
    code: "VALIDATION_FAILED",
    message:
      "ReelMimic mode requires a real reference video (path or http(s) URL). " +
      "Provide referencePath/referenceUrl, trend.source_url, trend.reference_path, or a video in references[]. " +
      "Do not use text placeholders.",
    component: "engines.reference",
    context: { trendId: opts.trend.id, topic: opts.trend.topic },
  });
}

/** Deterministic format-level analysis for offline/dev — never a copied script. */
export function buildOfflineFormatAnalysis(trend: TrendCandidate): ReferenceAnalysisReport {
  const fp = topicFingerprint(trend.topic);
  const shotCount = 4 + (parseInt(fp.slice(0, 2), 16) % 5);
  return normalizeAnalysisReport(
    {
      duration: 30 + (parseInt(fp.slice(2, 4), 16) % 30),
      shot_count: shotCount,
      pacing: { pattern: "hook-escalation-payoff", tempo: "shorts-fast" },
      transitions: { primary: "cut", density: "medium" },
      framing: { dominant: "medium", closeup_ratio: 0.3 },
      camera_movement: { primary: "static-with-push-ins" },
      colors: { mood: "warm-playful" },
      bpm: 100 + (parseInt(fp.slice(4, 6), 16) % 40),
      rhythm: { phrase_seconds: 3 },
      style: { genre: "2d-cartoon-short" },
      hook_pattern: "problem-in-first-3s",
      scene_structure: ["hook", "escalation", "payoff"],
      format_only: true,
    },
    {
      stub: true,
      notes: [
        "OFFLINE FIXTURE format analysis derived from topic fingerprint",
        "Not a real video probe — structure inspiration only",
        `topic_fingerprint=${fp}`,
      ],
    },
  );
}

/**
 * Story-format contract extracted from reference analysis.
 * Distinct from OriginalStory — never includes copied dialogue/script.
 */
export interface StoryFormatHints {
  hook_pattern?: string;
  pacing?: unknown;
  shot_count?: number;
  scene_structure?: string[];
  framing?: unknown;
  transitions?: unknown;
  camera_movement?: unknown;
  bpm?: number | null;
  escalation?: string;
  payoff?: string;
  analysis_only: true;
  source_path?: string | null;
  source_url?: string | null;
  offline_fixture: boolean;
}

export function toStoryFormatHints(report: ReferenceAnalysisReport): StoryFormatHints {
  const raw = (report.raw && typeof report.raw === "object" ? report.raw : {}) as Record<string, unknown>;
  return {
    hook_pattern: typeof raw.hook_pattern === "string" ? raw.hook_pattern : "problem-in-first-3s",
    pacing: report.pacing,
    shot_count: report.shot_count,
    scene_structure: Array.isArray(raw.scene_structure)
      ? (raw.scene_structure as string[])
      : ["hook", "escalation", "payoff"],
    framing: report.framing,
    transitions: report.transitions,
    camera_movement: report.camera_movement,
    bpm: report.bpm ?? null,
    escalation: "mid-story obstacle with original character solution",
    payoff: "original resolution + character-specific CTA",
    analysis_only: true,
    source_path: report.source_path,
    source_url: report.source_url,
    offline_fixture: report.stub === true,
  };
}
