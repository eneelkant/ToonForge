import type { AdapterProbe } from "../types.js";
import type { ReelMimicHttpClient } from "./http.js";

export interface ReferenceAnalysisRequest {
  sourcePath?: string;
  sourceUrl?: string;
  outDir: string;
}

export interface ReferenceAnalysisReport {
  stub: boolean;
  source_path?: string | null;
  source_url?: string | null;
  analyzed_at: string;
  duration?: number;
  shot_count?: number;
  pacing?: unknown;
  transitions?: unknown;
  framing?: unknown;
  camera_movement?: unknown;
  colors?: unknown;
  bpm?: number | null;
  rhythm?: unknown;
  style?: unknown;
  notes: string[];
  raw?: unknown;
}

export interface ReferenceAnalysisResult {
  reportPath: string;
  report: ReferenceAnalysisReport;
  stub: boolean;
  notes: string[];
}

export interface CreateProjectInput {
  brief: string;
  referencePath?: string;
  referenceUrl?: string;
  agent?: "claude" | "codex";
  lang?: "en" | "zh-TW" | "zh-CN";
  title?: string;
}

export interface ProjectStatus {
  id: string;
  stage?: string;
  error?: string | null;
  updatedAt?: string;
  raw: unknown;
}

export interface ArtifactDiscovery {
  projectId: string;
  videoPath?: string;
  analysisReportPath?: string;
  storyboardPath?: string;
  planPath?: string;
  failed: boolean;
  detail: string;
}

export interface ReelMimicAdapter extends AdapterProbe {
  name: "reelmimic";
  client: ReelMimicHttpClient | null;
  health(): Promise<{ ok: boolean; baseUrl: string; detail?: string; agents?: unknown }>;
  analyzeReference(req: ReferenceAnalysisRequest): Promise<ReferenceAnalysisResult>;
  getAnalysisReport(projectId: string): Promise<ReferenceAnalysisReport | null>;
  createProject(input: CreateProjectInput): Promise<{ projectId: string }>;
  getProject(projectId: string): Promise<ProjectStatus>;
  approve(projectId: string): Promise<void>;
  resume(projectId: string): Promise<void>;
  retry(projectId: string): Promise<void>;
  cancel(projectId: string): Promise<void>;
  discoverArtifacts(projectId: string): Promise<ArtifactDiscovery>;
}
