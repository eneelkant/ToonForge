import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MediaKind } from "./media.js";

export interface ReferenceProvenanceEntry {
  id: string;
  role: "reference-format-analysis" | "trend_structure" | string;
  pathOrUrl?: string;
  sourceProvider?: string;
  observedAt?: string;
  footageReused: boolean;
  assetsReused: boolean;
  analysisOnly: boolean;
  licenseStatus: "unknown" | "authorized" | "not_applicable";
  designation?: string;
  notes?: string;
}

export interface ProvenanceRecord {
  referenceSources: ReferenceProvenanceEntry[];
  creativeTransformations: string[];
  charactersUsed: Array<{ id: string; version: string; role?: string }>;
  generatedAssets: Array<{
    type: string;
    path: string;
    kind: MediaKind;
    provider?: string;
  }>;
  externalAssets: Array<{ pathOrUrl: string; license?: string; notes?: string }>;
  licenses: Array<{ asset: string; license: string }>;
  providers: Array<{ name: string; role: string }>;
  timestamps: Array<{ event: string; at: string }>;
  originalContent: boolean;
  thirdPartyFootage: boolean;
  policyNotes: string[];
  pipelineMode?: "offline_fixture" | "reelmimic" | "openmontage";
  production?: {
    backend: "offline_fixture" | "reelmimic" | "openmontage";
    upstreamRunId?: string;
    toolVersions?: Record<string, string>;
    startedAt?: string;
    endedAt?: string;
    outcome?: string;
    retryCount?: number;
    artifactPaths?: string[];
    validationStatus?: string;
    errorClass?: string;
    estimatedCostUsd?: number;
    actualCostUsd?: number;
    analysisOnly?: boolean;
    thirdPartyFootageReused?: boolean;
    thirdPartyAssetsReused?: boolean;
    approval?: string;
  };
}

export function emptyProvenance(): ProvenanceRecord {
  return {
    referenceSources: [],
    creativeTransformations: [],
    charactersUsed: [],
    generatedAssets: [],
    externalAssets: [],
    licenses: [],
    providers: [],
    timestamps: [],
    originalContent: true,
    thirdPartyFootage: false,
    policyNotes: [],
  };
}

export function addReferenceProvenance(
  record: ProvenanceRecord,
  entry: ReferenceProvenanceEntry,
): void {
  record.referenceSources.push(entry);
  if (entry.licenseStatus === "unknown") {
    record.policyNotes.push(
      `Reference ${entry.id}: license/authorization unknown — analysis-only; not cleared for reuse`,
    );
  }
  if (entry.footageReused || entry.assetsReused) {
    record.thirdPartyFootage = true;
    record.policyNotes.push(`Reference ${entry.id}: reuse flagged — publish must fail closed`);
  }
}

export function stamp(event: string): { event: string; at: string } {
  return { event, at: new Date().toISOString() };
}

export function persistProvenance(projectDir: string, record: ProvenanceRecord): string {
  mkdirSync(projectDir, { recursive: true });
  const path = join(projectDir, "provenance.json");
  writeFileSync(path, JSON.stringify(record, null, 2));
  return path;
}

export function loadProvenance(projectDir: string): ProvenanceRecord | null {
  const path = join(projectDir, "provenance.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ProvenanceRecord;
}

/** Fail-closed gate for publishing. Set allowDevFixtures for dry-run/CI. */
export function evaluateProvenanceForPublish(
  record: ProvenanceRecord,
  opts: { allowDevFixtures?: boolean } = {},
): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!record.originalContent) errors.push("originalContent must be true");
  if (record.thirdPartyFootage) errors.push("thirdPartyFootage is not allowed");
  if (record.charactersUsed.length === 0) errors.push("charactersUsed required");
  if (record.generatedAssets.length === 0) errors.push("generatedAssets required");
  const badAssets = record.generatedAssets.filter((a) => a.kind === "invalid_stub");
  if (badAssets.length > 0) {
    errors.push(`invalid stub assets: ${badAssets.map((a) => a.path).join(", ")}`);
  }
  if (!opts.allowDevFixtures) {
    const liveAssets = record.generatedAssets.filter((a) =>
      ["video", "audio", "thumbnail"].includes(a.type),
    );
    for (const a of liveAssets) {
      if (a.kind === "ffmpeg_dev") {
        errors.push(`dev fixture not allowed for live publish: ${a.path}`);
      }
    }
  }
  if (record.creativeTransformations.length === 0) {
    errors.push("creativeTransformations required (structure inspiration ≠ copy)");
  }
  return { ok: errors.length === 0, errors };
}
