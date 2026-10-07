import { ToonForgeError } from "../../../core/errors.js";
import type { YoutubeTrendsConfig } from "./youtube.js";
import type { TrendProvider } from "../types.js";
import { ManualSeedTrendProvider } from "./manual.js";
import { YoutubeTrendProvider } from "./youtube.js";

export { ManualSeedTrendProvider } from "./manual.js";
export {
  YoutubeTrendProvider,
  mapYoutubeItemToCandidate,
  computeYoutubeSignals,
  parseIso8601Duration,
  redactApiKey,
  type YoutubeTrendsConfig,
  type YoutubeTrendProviderOptions,
  type YoutubeMostPopularResponse,
  type YoutubeApiVideoItem,
} from "./youtube.js";

export interface CreateTrendProvidersOptions {
  youtubeTrends?: YoutubeTrendsConfig;
  niche?: string;
  /** Injected for tests. */
  youtubeFetch?: typeof fetch;
}

/** Known provider names keyed by channel `trend_sources` entry. */
export function listRegisteredTrendSourceNames(): string[] {
  return ["manual", "manual-seed", "youtube"].sort();
}

/**
 * Build trend providers from channel `trend_sources`.
 * Unknown names fail with CONFIG_INVALID (never silently ignored).
 */
export function createTrendProviders(
  sources: string[],
  options: CreateTrendProvidersOptions = {},
): TrendProvider[] {
  const names = sources.length > 0 ? sources : ["manual"];
  const providers: TrendProvider[] = [];
  const seen = new Set<string>();

  for (const raw of names) {
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);

    if (key === "manual" || key === "manual-seed") {
      providers.push(new ManualSeedTrendProvider());
      continue;
    }

    if (key === "youtube") {
      if (!options.youtubeTrends) {
        throw new ToonForgeError({
          code: "CONFIG_INVALID",
          message:
            'trend_sources includes "youtube" but youtubeTrends runtime config was not provided',
          component: "engines.trend.providers",
        });
      }
      providers.push(
        new YoutubeTrendProvider({
          config: options.youtubeTrends,
          niche: options.niche,
          fetchImpl: options.youtubeFetch,
        }),
      );
      continue;
    }

    throw new ToonForgeError({
      code: "CONFIG_INVALID",
      message: `Unknown trend source "${raw}". Registered: ${listRegisteredTrendSourceNames().join(", ")}`,
      component: "engines.trend.providers",
      context: { source: raw, registered: listRegisteredTrendSourceNames() },
    });
  }

  if (providers.length === 0) {
    throw new ToonForgeError({
      code: "CONFIG_INVALID",
      message: "No trend providers configured (trend_sources empty after normalization)",
      component: "engines.trend.providers",
    });
  }

  return providers;
}

/** Convenience: first configured provider (channels typically list one). */
export function createTrendProvider(
  sources: string[],
  options: CreateTrendProvidersOptions = {},
): TrendProvider {
  return createTrendProviders(sources, options)[0]!;
}
