import { ToonForgeError } from "../../../core/errors.js";
import { rootLogger } from "../../../core/logging.js";
import { newId } from "../../../core/ids.js";
import { scoreTrend, type TrendCandidate, type TrendProvider } from "../types.js";

const log = rootLogger.child("engines.trend.youtube");

export interface YoutubeTrendsConfig {
  enabled: boolean;
  apiKey?: string;
  regionCode: string;
  categoryId?: string;
  maxResults: number;
  timeoutMs: number;
  maxRetries: number;
}

export type FetchLike = typeof fetch;

export interface YoutubeTrendProviderOptions {
  config: YoutubeTrendsConfig;
  /** Channel niche for nicheFit scoring. */
  niche?: string;
  fetchImpl?: FetchLike;
  /** Override clock for tests. */
  now?: () => Date;
}

interface YtThumb {
  url?: string;
}
interface YtSnippet {
  title?: string;
  description?: string;
  channelId?: string;
  channelTitle?: string;
  publishedAt?: string;
  categoryId?: string;
  tags?: string[];
  thumbnails?: Record<string, YtThumb>;
}
interface YtStatistics {
  viewCount?: string;
  likeCount?: string;
  commentCount?: string;
}
interface YtContentDetails {
  duration?: string;
}
export interface YoutubeApiVideoItem {
  id?: string;
  snippet?: YtSnippet;
  statistics?: YtStatistics;
  contentDetails?: YtContentDetails;
}
export interface YoutubeMostPopularResponse {
  items?: YoutubeApiVideoItem[];
  error?: { code?: number; message?: string; errors?: Array<{ reason?: string }> };
}

/** Strip API keys from URLs/messages before logging or throwing. */
export function redactApiKey(text: string, apiKey?: string): string {
  let out = text;
  if (apiKey) {
    out = out.split(apiKey).join("[REDACTED]");
  }
  out = out.replace(/([?&]key=)[^&]+/gi, "$1[REDACTED]");
  return out;
}

/** Parse ISO-8601 duration (PT#H#M#S) to seconds. */
export function parseIso8601Duration(iso?: string): number | undefined {
  if (!iso || typeof iso !== "string") return undefined;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!m) return undefined;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  return h * 3600 + min * 60 + s;
}

function num(v: string | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Snapshot-based proxies (official mostPopular is not a time-series).
 * Documented: velocity is an estimated proxy, not measured delta velocity.
 */
export function computeYoutubeSignals(input: {
  title: string;
  description: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  niche: string;
  categoryId?: string;
  now: Date;
}): {
  velocity: number;
  engagement: number;
  freshness: number;
  nicheFit: number;
  originality: number;
  saturation: number;
  policyRisk: number;
  notes: string[];
} {
  const notes: string[] = [
    "velocity is a snapshot proxy (views/age), not measured time-series velocity",
  ];
  const published = Date.parse(input.publishedAt);
  const ageHours = Number.isFinite(published)
    ? Math.max(0.25, (input.now.getTime() - published) / 3_600_000)
    : 72;
  const ageDays = ageHours / 24;

  // Freshness: 1 within ~6h, decays toward 0 over ~14 days
  const freshness = clamp01(1 - ageDays / 14);

  // Engagement: likes+comments relative to views (typical YouTube rates are small)
  const interactions = input.likeCount + input.commentCount;
  const engRaw = input.viewCount > 0 ? interactions / input.viewCount : 0;
  const engagement = clamp01(engRaw / 0.08); // ~8% interactions ≈ 1.0 (optimistic ceiling)

  // Velocity proxy: log-scaled views per hour
  const vph = input.viewCount / ageHours;
  const velocity = clamp01(Math.log10(1 + vph) / 6); // ~1e6 vph ≈ 1.0

  // Niche fit: keyword overlap with channel niche
  const hay = `${input.title} ${input.description}`.toLowerCase();
  const needles = input.niche
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  const hits = needles.filter((w) => hay.includes(w)).length;
  const nicheFit = needles.length
    ? clamp01(0.35 + (hits / needles.length) * 0.65)
    : 0.5;

  // Originality: conservative — high views often means crowded formats
  const originality = clamp01(0.85 - Math.log10(1 + input.viewCount) / 20);

  // Saturation/competition proxy from popularity
  const saturation = clamp01(Math.log10(1 + input.viewCount) / 8);

  // Policy risk: conservative heuristics on title/description
  let policyRisk = 0.12;
  if (/\b(official music video|lyrics|full movie|watch now free)\b/i.test(hay)) {
    policyRisk = 0.45;
    notes.push("elevated policyRisk: possible copyrighted entertainment packaging");
  }
  if (/\b(challenge|prank|fight)\b/i.test(hay) && /\bkids?\b/i.test(input.niche)) {
    policyRisk = Math.max(policyRisk, 0.35);
  }

  return {
    velocity,
    engagement,
    freshness,
    nicheFit,
    originality,
    saturation,
    policyRisk: clamp01(policyRisk),
    notes,
  };
}

export function mapYoutubeItemToCandidate(
  item: YoutubeApiVideoItem,
  opts: { niche: string; now: Date },
): TrendCandidate | null {
  const id = item.id;
  if (!id || typeof id !== "string") return null;
  const snippet = item.snippet ?? {};
  const title = (snippet.title ?? "").trim();
  if (!title) return null;
  const publishedAt = snippet.publishedAt ?? opts.now.toISOString();
  const views = num(item.statistics?.viewCount);
  const likes = num(item.statistics?.likeCount);
  const comments = num(item.statistics?.commentCount);
  const source_url = `https://www.youtube.com/watch?v=${id}`;

  const signals = computeYoutubeSignals({
    title,
    description: snippet.description ?? "",
    publishedAt,
    viewCount: views,
    likeCount: likes,
    commentCount: comments,
    niche: opts.niche,
    categoryId: snippet.categoryId,
    now: opts.now,
  });

  const score = scoreTrend({
    velocity: signals.velocity,
    engagement: signals.engagement,
    freshness: signals.freshness,
    nicheFit: signals.nicheFit,
    originality: signals.originality,
    saturation: signals.saturation,
    policyRisk: signals.policyRisk,
  });

  return {
    id: newId("trend"),
    topic: title.slice(0, 180),
    source: "youtube",
    source_url,
    timestamp: publishedAt,
    score,
    freshness: signals.freshness,
    velocity: signals.velocity,
    category: snippet.categoryId ? `yt-cat-${snippet.categoryId}` : "youtube-mostPopular",
    audience: /kids|child|family|cartoon|edu/i.test(opts.niche) ? "kids-families" : "general",
    risk: signals.policyRisk,
    cartoon_suitability: signals.nicheFit,
    competition: signals.saturation,
    references: [source_url],
    status: "candidate",
  };
}

export class YoutubeTrendProvider implements TrendProvider {
  name = "youtube";
  private readonly config: YoutubeTrendsConfig;
  private readonly niche: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  constructor(options: YoutubeTrendProviderOptions) {
    this.config = options.config;
    this.niche = options.niche ?? "cartoon";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async discover(input: { niche: string; limit?: number }): Promise<TrendCandidate[]> {
    if (!this.config.enabled) {
      throw new ToonForgeError({
        code: "CONFIG_INVALID",
        message:
          "YouTube trend provider selected but TOONFORGE_YOUTUBE_TRENDS_ENABLED is not true",
        component: "engines.trend.youtube",
        retryable: false,
      });
    }
    if (!this.config.apiKey?.trim()) {
      throw new ToonForgeError({
        code: "CONFIG_INVALID",
        message:
          "YouTube trend provider requires YOUTUBE_DATA_API_KEY (do not silently fall back to manual)",
        component: "engines.trend.youtube",
        retryable: false,
      });
    }

    const niche = input.niche || this.niche;
    const maxResults = Math.min(
      50,
      Math.max(1, input.limit ?? this.config.maxResults),
    );

    const raw = await this.fetchMostPopular(maxResults);
    const items = Array.isArray(raw.items) ? raw.items : [];
    if (items.length === 0) {
      throw new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: "YouTube mostPopular returned no items",
        component: "engines.trend.youtube",
        retryable: true,
        context: { failureClass: "empty_results" },
      });
    }

    const now = this.now();
    const candidates: TrendCandidate[] = [];
    for (const item of items) {
      const mapped = mapYoutubeItemToCandidate(item, { niche, now });
      if (mapped) candidates.push(mapped);
    }
    if (candidates.length === 0) {
      throw new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: "YouTube response contained no mappable video items",
        component: "engines.trend.youtube",
        retryable: true,
        context: { failureClass: "malformed_response" },
      });
    }

    log.info("youtube.trends.discovered", {
      count: candidates.length,
      region: this.config.regionCode,
      categoryId: this.config.categoryId ?? null,
    });
    return candidates.slice(0, maxResults);
  }

  private async fetchMostPopular(maxResults: number): Promise<YoutubeMostPopularResponse> {
    const params = new URLSearchParams({
      part: "snippet,contentDetails,statistics",
      chart: "mostPopular",
      maxResults: String(maxResults),
      regionCode: this.config.regionCode,
      key: this.config.apiKey!,
    });
    if (this.config.categoryId?.trim()) {
      params.set("videoCategoryId", this.config.categoryId.trim());
    }
    const url = `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`;
    const safeUrl = redactApiKey(url, this.config.apiKey);

    let attempt = 0;
    const maxAttempts = Math.max(1, this.config.maxRetries);
    let lastError: unknown;

    while (attempt < maxAttempts) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method: "GET",
          signal: controller.signal,
          headers: { accept: "application/json" },
        });

        if (res.status === 401 || res.status === 403) {
          throw new ToonForgeError({
            code: "UPSTREAM_ERROR",
            message: `YouTube Data API auth/permission failure (HTTP ${res.status})`,
            component: "engines.trend.youtube",
            retryable: false,
            context: { failureClass: "auth", status: res.status, url: safeUrl },
          });
        }
        if (res.status === 429) {
          throw new ToonForgeError({
            code: "UPSTREAM_ERROR",
            message: "YouTube Data API rate limited or quota exceeded (HTTP 429)",
            component: "engines.trend.youtube",
            retryable: true,
            context: { failureClass: "quota_or_rate", status: 429, url: safeUrl },
          });
        }
        if (res.status >= 500) {
          throw new ToonForgeError({
            code: "UPSTREAM_ERROR",
            message: `YouTube Data API server error (HTTP ${res.status})`,
            component: "engines.trend.youtube",
            retryable: true,
            context: { failureClass: "server", status: res.status, url: safeUrl },
          });
        }
        if (!res.ok) {
          throw new ToonForgeError({
            code: "UPSTREAM_ERROR",
            message: `YouTube Data API request failed (HTTP ${res.status})`,
            component: "engines.trend.youtube",
            retryable: false,
            context: { failureClass: "http", status: res.status, url: safeUrl },
          });
        }

        let body: YoutubeMostPopularResponse;
        try {
          body = (await res.json()) as YoutubeMostPopularResponse;
        } catch (error) {
          throw new ToonForgeError({
            code: "UPSTREAM_ERROR",
            message: "YouTube Data API returned malformed JSON",
            component: "engines.trend.youtube",
            retryable: true,
            cause: error,
            context: { failureClass: "malformed_json", url: safeUrl },
          });
        }

        if (body.error) {
          const reason = body.error.errors?.[0]?.reason ?? "api_error";
          const retryable = /quota|rateLimit/i.test(reason);
          throw new ToonForgeError({
            code: "UPSTREAM_ERROR",
            message: redactApiKey(
              `YouTube API error: ${body.error.message ?? reason}`,
              this.config.apiKey,
            ),
            component: "engines.trend.youtube",
            retryable,
            context: {
              failureClass: reason,
              status: body.error.code,
              url: safeUrl,
            },
          });
        }

        return body;
      } catch (error) {
        lastError = error;
        if (error instanceof ToonForgeError && !error.retryable) throw error;
        const isAbort =
          error instanceof Error &&
          (error.name === "AbortError" || /aborted|timeout/i.test(error.message));
        const isNetwork =
          error instanceof Error &&
          /fetch|network|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(error.message);

        if (error instanceof ToonForgeError) {
          if (!error.retryable || attempt >= maxAttempts) throw error;
          log.warn("youtube.trends.retry", {
            attempt,
            failureClass: error.context.failureClass,
          });
        } else if (isAbort || isNetwork) {
          if (attempt >= maxAttempts) {
            throw new ToonForgeError({
              code: "UPSTREAM_ERROR",
              message: redactApiKey(
                isAbort ? "YouTube Data API request timed out" : `YouTube Data API network failure: ${error instanceof Error ? error.message : String(error)}`,
                this.config.apiKey,
              ),
              component: "engines.trend.youtube",
              retryable: true,
              cause: error,
              context: {
                failureClass: isAbort ? "timeout" : "network",
                url: safeUrl,
              },
            });
          }
          log.warn("youtube.trends.retry", {
            attempt,
            failureClass: isAbort ? "timeout" : "network",
          });
        } else if (error instanceof ToonForgeError) {
          throw error;
        } else {
          throw new ToonForgeError({
            code: "UPSTREAM_ERROR",
            message: redactApiKey(
              error instanceof Error ? error.message : String(error),
              this.config.apiKey,
            ),
            component: "engines.trend.youtube",
            cause: error,
            context: { failureClass: "unknown", url: safeUrl },
          });
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof ToonForgeError
      ? lastError
      : new ToonForgeError({
          code: "UPSTREAM_ERROR",
          message: "YouTube Data API request failed after retries",
          component: "engines.trend.youtube",
          cause: lastError,
          context: { failureClass: "retry_exhausted" },
        });
  }
}
