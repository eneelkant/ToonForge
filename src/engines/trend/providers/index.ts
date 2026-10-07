import { ToonForgeError } from "../../../core/errors.js";
import type { TrendProvider } from "../types.js";
import { ManualSeedTrendProvider } from "./manual.js";

export { ManualSeedTrendProvider } from "./manual.js";

/** Known provider constructors keyed by channel `trend_sources` entry. */
const REGISTRY: Record<string, () => TrendProvider> = {
  manual: () => new ManualSeedTrendProvider(),
  "manual-seed": () => new ManualSeedTrendProvider(),
};

export function listRegisteredTrendSourceNames(): string[] {
  return Object.keys(REGISTRY).sort();
}

/**
 * Build trend providers from channel `trend_sources`.
 * Unknown names fail with CONFIG_INVALID (never silently ignored).
 */
export function createTrendProviders(sources: string[]): TrendProvider[] {
  const names = sources.length > 0 ? sources : ["manual"];
  const providers: TrendProvider[] = [];
  const seen = new Set<string>();

  for (const raw of names) {
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const factory = REGISTRY[key];
    if (!factory) {
      throw new ToonForgeError({
        code: "CONFIG_INVALID",
        message: `Unknown trend source "${raw}". Registered: ${listRegisteredTrendSourceNames().join(", ")}`,
        component: "engines.trend.providers",
        context: { source: raw, registered: listRegisteredTrendSourceNames() },
      });
    }
    providers.push(factory());
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
export function createTrendProvider(sources: string[]): TrendProvider {
  return createTrendProviders(sources)[0]!;
}
