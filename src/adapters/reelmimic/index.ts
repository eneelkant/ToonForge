import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ToonForgeError } from "../../core/errors.js";
import type { RuntimeConfig } from "../../core/config.js";
import type { AdapterAvailability } from "../types.js";
import type { ReelMimicAdapter, ReferenceAnalysisRequest, ReferenceAnalysisResult } from "./types.js";

export type { ReelMimicAdapter, ReferenceAnalysisRequest, ReferenceAnalysisResult } from "./types.js";

/**
 * Foundation adapter: probes the real ReelMimic HTTP server when enabled.
 * Full production mapping (approve/produce/SSE) is deferred to a later phase.
 * Does not invent CLI flags beyond those documented upstream.
 */
export function createReelMimicAdapter(config: RuntimeConfig["reelmimic"]): ReelMimicAdapter {
  return {
    name: "reelmimic",
    async probe(): Promise<AdapterAvailability> {
      if (!config.enabled) {
        return { status: "disabled", detail: "REELMIMIC_ENABLED is not true" };
      }
      try {
        const res = await fetch(`${config.baseUrl}/api/agents`, {
          signal: AbortSignal.timeout(2000),
        });
        if (!res.ok) {
          return {
            status: "unavailable",
            detail: `HTTP ${res.status} from ${config.baseUrl}/api/agents`,
          };
        }
        return { status: "ready", detail: config.baseUrl };
      } catch (error) {
        return {
          status: "unavailable",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async analyzeReference(req: ReferenceAnalysisRequest): Promise<ReferenceAnalysisResult> {
      mkdirSync(req.outDir, { recursive: true });
      const reportPath = join(req.outDir, "reference-analysis.json");
      // Foundation stub: structured placeholder. Real path shells to upstream analyze.py later.
      const report = {
        stub: true,
        source_path: req.sourcePath,
        source_url: req.sourceUrl ?? null,
        analyzed_at: new Date().toISOString(),
        notes: [
          "ReelMimic analyze.py integration not wired in foundation phase",
          "Expected upstream output fields include duration, shots, pacing, framing, audio",
        ],
      };
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      return {
        reportPath,
        stub: true,
        notes: report.notes,
      };
    },
    async createProject() {
      const availability = await this.probe();
      if (availability.status !== "ready") {
        throw new ToonForgeError({
          code: "ADAPTER_UNAVAILABLE",
          message: "ReelMimic is not ready; project create is not implemented without server",
          component: "adapters.reelmimic",
          context: { availability },
        });
      }
      throw new ToonForgeError({
        code: "NOT_IMPLEMENTED",
        message: "ReelMimic HTTP project create will be implemented in the production-adapter phase",
        component: "adapters.reelmimic",
      });
    },
  };
}
