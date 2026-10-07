import { createHash } from "node:crypto";
import { newId } from "../../core/ids.js";

export interface TrendCandidate {
  id: string;
  topic: string;
  source: string;
  source_url?: string;
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

const DEFAULT_WEIGHTS: TrendScoreWeights = {
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
  weights: TrendScoreWeights = DEFAULT_WEIGHTS,
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

/** Deterministic local provider for offline/dev — not fabricated live rankings. */
export class ManualSeedTrendProvider implements TrendProvider {
  name = "manual-seed";
  constructor(private readonly seeds: Array<{ topic: string; category: string }> = [
    { topic: "friendship problem-solving shorts", category: "kids-cartoon" },
    { topic: "inventor kid vs tiny robot mishap", category: "kids-cartoon" },
    { topic: "forest storyteller bedtime micro-tales", category: "kids-cartoon" },
  ]) {}

  async discover(input: { niche: string; limit?: number }): Promise<TrendCandidate[]> {
    const limit = input.limit ?? 5;
    return this.seeds.slice(0, limit).map((seed, index) => {
      const freshness = 1 - index * 0.1;
      const velocity = 0.7 - index * 0.05;
      const nicheFit = /cartoon|kids|story/i.test(input.niche) ? 0.9 : 0.5;
      const originality = 0.8;
      const competition = 0.4 + index * 0.05;
      const risk = 0.1;
      const score = scoreTrend({
        velocity,
        engagement: 0.6,
        freshness,
        nicheFit,
        originality,
        saturation: competition,
        policyRisk: risk,
      });
      return {
        id: newId("trend"),
        topic: seed.topic,
        source: this.name,
        timestamp: new Date().toISOString(),
        score,
        freshness,
        velocity,
        category: seed.category,
        audience: "kids-families",
        risk,
        cartoon_suitability: nicheFit,
        competition,
        references: [],
        status: "candidate" as const,
      };
    });
  }
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
