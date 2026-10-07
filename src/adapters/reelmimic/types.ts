import type { AdapterProbe } from "../types.js";

export interface ReferenceAnalysisRequest {
  sourcePath: string;
  outDir: string;
  /** URL analysis is supported by upstream analyze.py; ToonForge defaults to local paths. */
  sourceUrl?: string;
}

export interface ReferenceAnalysisResult {
  reportPath: string;
  stub: boolean;
  notes: string[];
}

export interface ReelMimicAdapter extends AdapterProbe {
  name: "reelmimic";
  analyzeReference(req: ReferenceAnalysisRequest): Promise<ReferenceAnalysisResult>;
  createProject(input: {
    brief: string;
    referencePath?: string;
    referenceUrl?: string;
  }): Promise<{ projectId: string; stub: boolean }>;
}
