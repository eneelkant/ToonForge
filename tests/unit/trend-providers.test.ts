import { describe, expect, it } from "vitest";
import {
  createTrendProvider,
  createTrendProviders,
  discoverTrendsForChannel,
  listRegisteredTrendSourceNames,
  ManualSeedTrendProvider,
} from "../../src/engines/trend/index.js";
import { ToonForgeError } from "../../src/core/errors.js";
import { loadChannelConfig } from "../../src/core/config.js";

describe("trend provider factory", () => {
  it("registers manual / manual-seed / youtube", () => {
    expect(listRegisteredTrendSourceNames()).toEqual(["manual", "manual-seed", "youtube"]);
  });

  it("creates ManualSeedTrendProvider from channel trend_sources", async () => {
    const channel = loadChannelConfig("config/channels/cartoon-default.yaml");
    expect(channel.trend_sources).toContain("manual");
    const provider = createTrendProvider(channel.trend_sources);
    expect(provider).toBeInstanceOf(ManualSeedTrendProvider);
    const trends = await provider.discover({ niche: channel.niche, limit: 2 });
    expect(trends.length).toBe(2);
    expect(trends[0]!.source).toBe("manual");
  });

  it("discovers via configured sources without hardcoding ManualSeed in caller", async () => {
    const { trends, providers } = await discoverTrendsForChannel({
      trendSources: ["manual"],
      niche: "kids cartoon",
      limit: 3,
    });
    expect(providers).toEqual(["manual"]);
    expect(trends.length).toBeGreaterThan(0);
  });

  it("fails clearly on unknown provider names", () => {
    expect(() => createTrendProviders(["manual", "youtube-live-scrape"])).toThrow(ToonForgeError);
    try {
      createTrendProviders(["not-a-provider"]);
    } catch (error) {
      expect(error).toMatchObject({ code: "CONFIG_INVALID" });
    }
  });

  it("defaults empty sources to manual", async () => {
    const providers = createTrendProviders([]);
    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe("manual");
  });

  it("dedupes duplicate source names", () => {
    const providers = createTrendProviders(["manual", "manual-seed", "manual"]);
    // manual and manual-seed are distinct keys but both ManualSeed — two entries after seen-key dedupe of exact keys
    expect(providers.length).toBe(2);
  });
});
