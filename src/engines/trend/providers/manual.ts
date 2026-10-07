import { newId } from "../../../core/ids.js";
import { scoreTrend, type TrendCandidate, type TrendProvider } from "../types.js";

/** Deterministic local provider for offline/dev — not fabricated live rankings. */
export class ManualSeedTrendProvider implements TrendProvider {
  name = "manual";

  constructor(
    private readonly seeds: Array<{ topic: string; category: string }> = [
      { topic: "friendship problem-solving shorts", category: "kids-cartoon" },
      { topic: "inventor kid vs tiny robot mishap", category: "kids-cartoon" },
      { topic: "forest storyteller bedtime micro-tales", category: "kids-cartoon" },
    ],
  ) {}

  async discover(input: { niche: string; limit?: number }): Promise<TrendCandidate[]> {
    const limit = input.limit ?? 5;
    return this.seeds.slice(0, limit).map((seed, index) => {
      const freshness = 1 - index * 0.1;
      const velocity = 0.7 - index * 0.05;
      const nicheFit = /cartoon|kids|story|edu/i.test(input.niche) ? 0.9 : 0.5;
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
