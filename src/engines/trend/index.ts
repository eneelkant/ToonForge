export {
  type TrendCandidate,
  type TrendProvider,
  type TrendScoreWeights,
  DEFAULT_TREND_WEIGHTS,
  DOCUMENTED_TREND_SOURCES,
  scoreTrend,
  dedupeTrends,
  selectOpportunity,
  topicFingerprint,
} from "./types.js";

export {
  ManualSeedTrendProvider,
  YoutubeTrendProvider,
  createTrendProvider,
  createTrendProviders,
  listRegisteredTrendSourceNames,
  mapYoutubeItemToCandidate,
  computeYoutubeSignals,
  parseIso8601Duration,
  redactApiKey,
  type YoutubeTrendsConfig,
  type CreateTrendProvidersOptions,
} from "./providers/index.js";

import { dedupeTrends, type TrendCandidate, type TrendProvider } from "./types.js";
import {
  createTrendProviders,
  type CreateTrendProvidersOptions,
} from "./providers/index.js";

/** Discover + dedupe across all configured channel trend sources. */
export async function discoverTrendsForChannel(input: {
  trendSources: string[];
  niche: string;
  limit?: number;
  providerOptions?: CreateTrendProvidersOptions;
}): Promise<{ trends: TrendCandidate[]; providers: string[] }> {
  const providers = createTrendProviders(input.trendSources, {
    niche: input.niche,
    ...input.providerOptions,
  });
  const batches = await Promise.all(
    providers.map((p: TrendProvider) => p.discover({ niche: input.niche, limit: input.limit })),
  );
  return {
    trends: dedupeTrends(batches.flat()),
    providers: providers.map((p) => p.name),
  };
}
