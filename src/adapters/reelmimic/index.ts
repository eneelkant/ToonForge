import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { openAsBlob } from "node:fs";
import type { RuntimeConfig } from "../../core/config.js";
import { ToonForgeError } from "../../core/errors.js";
import { rootLogger } from "../../core/logging.js";
import type { AdapterAvailability } from "../types.js";
import { normalizeAnalysisReport, runAnalyzePy, writeAnalysisReport } from "./analyze.js";
import { ReelMimicHttpClient, type FetchLike } from "./http.js";
import type {
  ArtifactDiscovery,
  CreateProjectInput,
  ProjectStatus,
  ReelMimicAdapter,
  ReferenceAnalysisRequest,
  ReferenceAnalysisResult,
} from "./types.js";

export type {
  ArtifactDiscovery,
  CreateProjectInput,
  ProjectStatus,
  ReelMimicAdapter,
  ReferenceAnalysisRequest,
  ReferenceAnalysisResult,
  ReferenceAnalysisReport,
} from "./types.js";
export { ReelMimicHttpClient } from "./http.js";

const log = rootLogger.child("adapters.reelmimic");

export interface ReelMimicAdapterOptions {
  fetchImpl?: FetchLike;
}

function requireEnabled(config: RuntimeConfig["reelmimic"]): void {
  if (!config.enabled) {
    throw new ToonForgeError({
      code: "ADAPTER_UNAVAILABLE",
      message: "ReelMimic adapter is disabled (set REELMIMIC_ENABLED=true)",
      component: "adapters.reelmimic",
    });
  }
}

export function createReelMimicAdapter(
  config: RuntimeConfig["reelmimic"],
  options: ReelMimicAdapterOptions = {},
): ReelMimicAdapter {
  const client = config.enabled
    ? new ReelMimicHttpClient({
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
        fetchImpl: options.fetchImpl,
      })
    : null;

  async function ensureClient(): Promise<ReelMimicHttpClient> {
    requireEnabled(config);
    if (!client) {
      throw new ToonForgeError({
        code: "ADAPTER_UNAVAILABLE",
        message: "ReelMimic HTTP client is not configured",
        component: "adapters.reelmimic",
      });
    }
    return client;
  }

  const adapter: ReelMimicAdapter = {
    name: "reelmimic",
    client,
    async probe(): Promise<AdapterAvailability> {
      if (!config.enabled) {
        return { status: "disabled", detail: "REELMIMIC_ENABLED is not true" };
      }
      try {
        const agents = await client!.getJson("/api/agents");
        return { status: "ready", detail: JSON.stringify(agents) };
      } catch (error) {
        return {
          status: "unavailable",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async health() {
      if (!config.enabled || !client) {
        return { ok: false, baseUrl: config.baseUrl, detail: "disabled" };
      }
      try {
        const agents = await client.getJson("/api/agents");
        return { ok: true, baseUrl: config.baseUrl, detail: "healthy", agents };
      } catch (error) {
        return {
          ok: false,
          baseUrl: config.baseUrl,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async analyzeReference(req: ReferenceAnalysisRequest): Promise<ReferenceAnalysisResult> {
      if (!req.sourcePath && !req.sourceUrl) {
        throw new ToonForgeError({
          code: "VALIDATION_FAILED",
          message: "analyzeReference requires sourcePath or sourceUrl",
          component: "adapters.reelmimic",
        });
      }
      if (req.sourceUrl && !/^https?:\/\//i.test(req.sourceUrl)) {
        throw new ToonForgeError({
          code: "VALIDATION_FAILED",
          message: "sourceUrl must be http(s)",
          component: "adapters.reelmimic",
        });
      }

      if (config.root) {
        try {
          const report = await runAnalyzePy({
            reelmimicRoot: config.root,
            sourcePath: req.sourcePath,
            sourceUrl: req.sourceUrl,
            outDir: req.outDir,
            timeoutMs: config.timeoutMs,
          });
          const reportPath = writeAnalysisReport(req.outDir, report);
          return { reportPath, report, stub: false, notes: report.notes };
        } catch (error) {
          log.warn("reelmimic.analyze.py_failed", {
            error: error instanceof Error ? error.message : String(error),
          });
          // Fall through to structured stub only when explicitly allowed? Prefer throw for real failures.
          throw error;
        }
      }

      const report = normalizeAnalysisReport(
        {},
        {
          stub: true,
          sourcePath: req.sourcePath,
          sourceUrl: req.sourceUrl,
          notes: [
            "REELMIMIC_ROOT not set; wrote structured placeholder analysis",
            "Set REELMIMIC_ROOT to a ReelMimic checkout to run analyze.py",
            "Do not use third-party footage as production assets — analysis only",
          ],
        },
      );
      const reportPath = writeAnalysisReport(req.outDir, report);
      return { reportPath, report, stub: true, notes: report.notes };
    },
    async getAnalysisReport(projectId: string) {
      const http = await ensureClient();
      // Prefer reading analysis/report.json via files route when project exists.
      try {
        const raw = await http.getJson(`/files/${encodeURIComponent(projectId)}/analysis/report.json`);
        return normalizeAnalysisReport(raw, {
          stub: false,
          notes: ["Loaded from ReelMimic project analysis/report.json"],
        });
      } catch {
        const snap = await http.getJson<Record<string, unknown>>(`/api/projects/${encodeURIComponent(projectId)}`);
        return normalizeAnalysisReport(snap.analysis ?? snap, {
          stub: true,
          notes: ["analysis/report.json not available; used project snapshot fields"],
        });
      }
    },
    async createProject(input: CreateProjectInput) {
      const http = await ensureClient();
      if (!input.brief.trim()) {
        throw new ToonForgeError({
          code: "VALIDATION_FAILED",
          message: "brief is required",
          component: "adapters.reelmimic",
        });
      }
      if (!input.referencePath && !input.referenceUrl) {
        throw new ToonForgeError({
          code: "VALIDATION_FAILED",
          message: "referencePath or referenceUrl is required",
          component: "adapters.reelmimic",
        });
      }
      if (input.referenceUrl && !/^https?:\/\//i.test(input.referenceUrl)) {
        throw new ToonForgeError({
          code: "VALIDATION_FAILED",
          message: "referenceUrl must be http(s)",
          component: "adapters.reelmimic",
        });
      }

      const form = new FormData();
      form.set("brief", input.brief);
      form.set("agent", input.agent ?? "claude");
      form.set("lang", input.lang ?? "en");
      if (input.title) form.set("title", input.title);
      if (input.referenceUrl) form.set("url", input.referenceUrl);
      if (input.referencePath) {
        if (!existsSync(input.referencePath)) {
          throw new ToonForgeError({
            code: "VALIDATION_FAILED",
            message: `referencePath not found: ${input.referencePath}`,
            component: "adapters.reelmimic",
          });
        }
        const blob = await openAsBlob(input.referencePath);
        form.append("reference", blob, basename(input.referencePath));
      }

      log.info("reelmimic.createProject", {
        hasFile: Boolean(input.referencePath),
        hasUrl: Boolean(input.referenceUrl),
      });
      const created = await http.postMultipart<{ id: string }>("/api/projects", form);
      if (!created?.id) {
        throw new ToonForgeError({
          code: "UPSTREAM_ERROR",
          message: "ReelMimic create project response missing id",
          component: "adapters.reelmimic",
          context: { created },
        });
      }
      return { projectId: created.id };
    },
    async getProject(projectId: string): Promise<ProjectStatus> {
      const http = await ensureClient();
      const raw = await http.getJson<Record<string, unknown>>(`/api/projects/${encodeURIComponent(projectId)}`);
      const job = (raw.job as Record<string, unknown> | undefined) ?? raw;
      return {
        id: projectId,
        stage: job.stage != null ? String(job.stage) : undefined,
        error: job.error != null ? String(job.error) : null,
        updatedAt: job.updatedAt != null ? String(job.updatedAt) : undefined,
        raw,
      };
    },
    async approve(projectId: string) {
      const http = await ensureClient();
      await http.postJson(`/api/projects/${encodeURIComponent(projectId)}/approve`, {});
    },
    async resume(projectId: string) {
      const http = await ensureClient();
      await http.postJson(`/api/projects/${encodeURIComponent(projectId)}/resume`, {});
    },
    async retry(projectId: string) {
      const http = await ensureClient();
      await http.postJson(`/api/projects/${encodeURIComponent(projectId)}/retry`, {});
    },
    async cancel(projectId: string) {
      const http = await ensureClient();
      await http.postJson(`/api/projects/${encodeURIComponent(projectId)}/cancel`, {});
    },
    async discoverArtifacts(projectId: string): Promise<ArtifactDiscovery> {
      const status = await adapter.getProject(projectId);
      const failed = status.stage === "error" || Boolean(status.error);
      // When REELMIMIC_ROOT is known, inspect local project files; otherwise report from status.
      if (config.root) {
        const dir = join(config.root, "projects", projectId);
        const videoPath = join(dir, "out", "video.mp4");
        const analysisReportPath = join(dir, "analysis", "report.json");
        const storyboardPath = join(dir, "STORYBOARD.md");
        const planPath = join(dir, "plan.json");
        return {
          projectId,
          videoPath: existsSync(videoPath) ? videoPath : undefined,
          analysisReportPath: existsSync(analysisReportPath) ? analysisReportPath : undefined,
          storyboardPath: existsSync(storyboardPath) ? storyboardPath : undefined,
          planPath: existsSync(planPath) ? planPath : undefined,
          failed,
          detail: failed
            ? status.error || "stage=error"
            : existsSync(videoPath)
              ? "video artifact present"
              : `stage=${status.stage ?? "unknown"}; video not ready`,
        };
      }
      return {
        projectId,
        failed,
        detail: failed
          ? status.error || "stage=error"
          : `stage=${status.stage ?? "unknown"}; set REELMIMIC_ROOT for local artifact paths`,
      };
    },
  };

  return adapter;
}

/** Optional smoke helper used by tests/docs: returns skip reason when server is down. */
export async function smokeReelMimic(config: RuntimeConfig["reelmimic"]): Promise<{
  skipped: boolean;
  reason?: string;
  ready?: boolean;
}> {
  if (!config.enabled) return { skipped: true, reason: "REELMIMIC_ENABLED is not true" };
  const adapter = createReelMimicAdapter(config);
  const probe = await adapter.probe();
  if (probe.status !== "ready") {
    return { skipped: true, reason: probe.detail };
  }
  return { skipped: false, ready: true };
}

export function readLocalAnalysisJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}
