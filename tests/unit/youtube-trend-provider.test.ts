import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  YoutubeTrendProvider,
  computeYoutubeSignals,
  createTrendProviders,
  discoverTrendsForChannel,
  mapYoutubeItemToCandidate,
  parseIso8601Duration,
  redactApiKey,
  type YoutubeMostPopularResponse,
} from "../../src/engines/trend/index.js";
import { ToonForgeError } from "../../src/core/errors.js";
import { handleTool } from "../../src/mcp/handlers.js";

const FIXTURE = JSON.parse(
  readFileSync(join("tests/fixtures/youtube-mostPopular.json"), "utf8"),
) as YoutubeMostPopularResponse;

const SECRET = "test-youtube-api-key-SECRET-do-not-leak";

function baseConfig(overrides: Partial<ConstructorParameters<typeof YoutubeTrendProvider>[0]["config"]> = {}) {
  return {
    enabled: true,
    apiKey: SECRET,
    regionCode: "US",
    maxResults: 25,
    timeoutMs: 5_000,
    maxRetries: 2,
    ...overrides,
  };
}

function mockFetch(impl: (url: string) => Promise<Response>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    return impl(url);
  }) as unknown as typeof fetch;
}

describe("YouTube trend provider", () => {
  it("parses ISO-8601 durations", () => {
    expect(parseIso8601Duration("PT45S")).toBe(45);
    expect(parseIso8601Duration("PT1M10S")).toBe(70);
    expect(parseIso8601Duration("PT1H2M3S")).toBe(3723);
  });

  it("redacts API keys from strings and URLs", () => {
    const url = `https://www.googleapis.com/youtube/v3/videos?key=${SECRET}&chart=mostPopular`;
    expect(redactApiKey(url, SECRET)).not.toContain(SECRET);
    expect(redactApiKey(url, SECRET)).toContain("key=[REDACTED]");
    expect(redactApiKey(`leak ${SECRET} end`, SECRET)).toBe("leak [REDACTED] end");
  });

  it("maps mostPopular items to TrendCandidate with source_url and references", () => {
    const now = new Date("2026-10-07T00:00:00Z");
    const mapped = mapYoutubeItemToCandidate(FIXTURE.items![0]!, {
      niche: "kids cartoon shorts",
      now,
    });
    expect(mapped).toBeTruthy();
    expect(mapped!.source).toBe("youtube");
    expect(mapped!.source_url).toBe("https://www.youtube.com/watch?v=synthVideo001");
    expect(mapped!.references).toEqual([mapped!.source_url]);
    expect(mapped!.topic.toLowerCase()).toContain("cartoon");
    expect(mapped!.category).toBe("yt-cat-1");
    expect(mapped!.score).toBeGreaterThan(0);
    expect(mapped!.freshness).toBeGreaterThan(0.5);
  });

  it("uses publishedAt for freshness and computes engagement/velocity proxies", () => {
    const now = new Date("2026-10-07T00:00:00Z");
    const fresh = computeYoutubeSignals({
      title: "Kids cartoon short",
      description: "cartoon kids friendship",
      publishedAt: "2026-10-06T18:00:00Z",
      viewCount: 100_000,
      likeCount: 5_000,
      commentCount: 500,
      niche: "kids cartoon",
      now,
    });
    const stale = computeYoutubeSignals({
      title: "Kids cartoon short",
      description: "cartoon kids friendship",
      publishedAt: "2026-09-01T00:00:00Z",
      viewCount: 100_000,
      likeCount: 5_000,
      commentCount: 500,
      niche: "kids cartoon",
      now,
    });
    expect(fresh.freshness).toBeGreaterThan(stale.freshness);
    expect(fresh.engagement).toBeGreaterThan(0);
    expect(fresh.velocity).toBeGreaterThan(0);
    expect(fresh.notes.some((n) => n.includes("snapshot proxy"))).toBe(true);
  });

  it("discovers successfully via mocked HTTP", async () => {
    const fetchImpl = mockFetch(async (url) => {
      expect(url).toContain("chart=mostPopular");
      expect(url).toContain("part=snippet%2CcontentDetails%2Cstatistics");
      expect(url).toContain(`key=${SECRET}`);
      return new Response(JSON.stringify(FIXTURE), { status: 200 });
    });
    const provider = new YoutubeTrendProvider({
      config: baseConfig(),
      niche: "kids cartoon",
      fetchImpl,
      now: () => new Date("2026-10-07T00:00:00Z"),
    });
    const trends = await provider.discover({ niche: "kids cartoon shorts", limit: 10 });
    expect(trends.length).toBe(3);
    expect(trends.every((t) => t.source === "youtube")).toBe(true);
    expect(trends.every((t) => t.source_url?.startsWith("https://www.youtube.com/watch?v="))).toBe(true);
    // Scores are not raw view-order only: synthVideo003 has huge views but higher policy risk
    expect(trends.map((t) => t.topic).join(" ")).toMatch(/cartoon|inventor|music/i);
  });

  it("fails on empty API response", async () => {
    const fetchImpl = mockFetch(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const provider = new YoutubeTrendProvider({ config: baseConfig(), fetchImpl });
    await expect(provider.discover({ niche: "kids" })).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      context: expect.objectContaining({ failureClass: "empty_results" }),
    });
  });

  it("fails on malformed JSON", async () => {
    const fetchImpl = mockFetch(async () => new Response("not-json", { status: 200 }));
    const provider = new YoutubeTrendProvider({ config: baseConfig({ maxRetries: 1 }), fetchImpl });
    await expect(provider.discover({ niche: "kids" })).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      context: expect.objectContaining({ failureClass: "malformed_json" }),
    });
  });

  it("fails clearly on 401/403 without retrying forever", async () => {
    const fetchImpl = mockFetch(async () => new Response("{}", { status: 403 }));
    const provider = new YoutubeTrendProvider({ config: baseConfig({ maxRetries: 3 }), fetchImpl });
    await expect(provider.discover({ niche: "kids" })).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      retryable: false,
      context: expect.objectContaining({ failureClass: "auth" }),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats 429 as retryable quota/rate failure", async () => {
    const fetchImpl = mockFetch(async () => new Response("{}", { status: 429 }));
    const provider = new YoutubeTrendProvider({ config: baseConfig({ maxRetries: 2 }), fetchImpl });
    await expect(provider.discover({ niche: "kids" })).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      retryable: true,
      context: expect.objectContaining({ failureClass: "quota_or_rate" }),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("handles network/timeout failures without leaking API key", async () => {
    const fetchImpl = mockFetch(async () => {
      throw new Error(`connect failed key=${SECRET}`);
    });
    const provider = new YoutubeTrendProvider({ config: baseConfig({ maxRetries: 1 }), fetchImpl });
    try {
      await provider.discover({ niche: "kids" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ToonForgeError);
      const err = error as ToonForgeError;
      expect(err.message).not.toContain(SECRET);
      expect(JSON.stringify(err.toJSON())).not.toContain(SECRET);
    }
  });

  it("fails when API key missing (no silent manual fallback)", async () => {
    const provider = new YoutubeTrendProvider({
      config: baseConfig({ apiKey: undefined }),
      fetchImpl: mockFetch(async () => new Response("{}", { status: 200 })),
    });
    await expect(provider.discover({ niche: "kids" })).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });

  it("fails when provider disabled but selected", async () => {
    const provider = new YoutubeTrendProvider({
      config: baseConfig({ enabled: false }),
      fetchImpl: mockFetch(async () => new Response("{}", { status: 200 })),
    });
    await expect(provider.discover({ niche: "kids" })).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });

  it("factory selects youtube and manual", () => {
    const names = createTrendProviders(["youtube", "manual"], {
      youtubeTrends: baseConfig(),
      niche: "kids",
    }).map((p) => p.name);
    expect(names).toEqual(["youtube", "manual"]);
  });

  it("discoverTrendsForChannel uses youtube via factory with mock fetch", async () => {
    const fetchImpl = mockFetch(async () => new Response(JSON.stringify(FIXTURE), { status: 200 }));
    const { trends, providers } = await discoverTrendsForChannel({
      trendSources: ["youtube"],
      niche: "kids cartoon",
      limit: 5,
      providerOptions: {
        youtubeTrends: baseConfig(),
        youtubeFetch: fetchImpl,
      },
    });
    expect(providers).toEqual(["youtube"]);
    expect(trends[0]!.source).toBe("youtube");
    expect(trends[0]!.references[0]).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=/);
  });
});

describe("MCP discover_trends factory wiring", () => {
  it("still returns manual trends for default channel without live YouTube", async () => {
    const result = (await handleTool("toonforge.discover_trends", { limit: 2 })) as {
      providers: string[];
      trends: unknown[];
      trend_sources: string[];
    };
    expect(result.trend_sources).toContain("manual");
    expect(result.providers).toContain("manual");
    expect(result.trends.length).toBeGreaterThan(0);
  });
});
