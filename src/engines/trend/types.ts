import { createHash } from "node:crypto";

export interface TrendCandidate {
  id: string;
  topic: string;
  source: string;
  source_url?: string;
  /** Optional local video path for reference-format analysis. */
  reference_path?: string;
  timestamp: string;
  score: number;
  freshness: number;
  velocity: number;
  category: string;
  audience: string;
  risk: number;
  cartoon_suitability: number;
  competition: number;
  references: string[];
  status: "candidate" | "selected" | "rejected";
}

export interface TrendScoreWeights {
  velocity: number;
  engagement: number;
  recency: number;
  nicheFit: number;
  originality: number;
  saturationPenalty: number;
  policyRiskPenalty: number;
}

export const DEFAULT_TREND_WEIGHTS: TrendScoreWeights = {
  velocity: 0.25,
  engagement: 0.2,
  recency: 0.15,
  nicheFit: 0.2,
  originality: 0.2,
  saturationPenalty: 0.15,
  policyRiskPenalty: 0.25,
};

export function scoreTrend(
  input: {
    velocity: number;
    engagement: number;
    freshness: number;
    nicheFit: number;
    originality: number;
    saturation: number;
    policyRisk: number;
  },
  weights: TrendScoreWeights = DEFAULT_TREND_WEIGHTS,
): number {
  const raw =
    input.velocity * weights.velocity +
    input.engagement * weights.engagement +
    input.freshness * weights.recency +
    input.nicheFit * weights.nicheFit +
    input.originality * weights.originality -
    input.saturation * weights.saturationPenalty -
    input.policyRisk * weights.policyRiskPenalty;
  return Math.max(0, Math.min(1, Number(raw.toFixed(4))));
}

export interface TrendProvider {
  name: string;
  discover(input: { niche: string; limit?: number }): Promise<TrendCandidate[]>;
}

export function dedupeTrends(trends: TrendCandidate[]): TrendCandidate[] {
  const seen = new Set<string>();
  const out: TrendCandidate[] = [];
  for (const t of trends) {
    const key = t.topic.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function selectOpportunity(trends: TrendCandidate[]): TrendCandidate | null {
  const ranked = [...trends].sort((a, b) => b.score - a.score);
  return ranked.find((t) => t.risk < 0.5 && t.cartoon_suitability >= 0.5) ?? null;
}

export function topicFingerprint(topic: string): string {
  return createHash("sha256").update(topic.toLowerCase().trim()).digest("hex").slice(0, 16);
}

/**
 * Documented trend_sources values for channel YAML.
 * - manual / manual-seed: deterministic offline seeds (default)
 * Future live providers must be registered explicitly; unknown names fail closed.
 */
export const DOCUMENTED_TREND_SOURCES = ["manual", "manual-seed"] as const;
