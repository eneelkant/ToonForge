import { ToonForgeError } from "../../core/errors.js";
import { rootLogger } from "../../core/logging.js";
import { withRetry } from "../../core/retry.js";

export type FetchLike = typeof fetch;

export interface ReelMimicHttpConfig {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl?: FetchLike;
}

const log = rootLogger.child("adapters.reelmimic.http");

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    throw new ToonForgeError({
      code: "CONFIG_INVALID",
      message: `ReelMimic base URL must be http(s): ${baseUrl}`,
      component: "adapters.reelmimic.http",
    });
  }
  return trimmed;
}

function toUpstream(error: unknown, context: Record<string, unknown>): ToonForgeError {
  if (error instanceof ToonForgeError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const retryable =
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      /fetch|network|ECONNREFUSED|ENOTFOUND|timeout/i.test(message));
  return new ToonForgeError({
    code: "UPSTREAM_ERROR",
    message,
    component: "adapters.reelmimic.http",
    retryable,
    cause: error,
    context,
  });
}

export class ReelMimicHttpClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: FetchLike;

  constructor(config: ReelMimicHttpConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.timeoutMs = config.timeoutMs;
    this.maxRetries = Math.max(1, config.maxRetries);
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async request(path: string, init: RequestInit & { idempotent?: boolean } = {}): Promise<Response> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const idempotent = init.idempotent ?? (init.method === undefined || init.method === "GET");
    const attempts = idempotent ? this.maxRetries : 1;

    return withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const { idempotent: _i, ...rest } = init;
          log.debug("reelmimic.request", { url, method: rest.method ?? "GET" });
          const res = await this.fetchImpl(url, { ...rest, signal: controller.signal });
          if (res.status >= 500) {
            throw new ToonForgeError({
              code: "UPSTREAM_ERROR",
              message: `ReelMimic HTTP ${res.status} for ${path}`,
              component: "adapters.reelmimic.http",
              retryable: true,
              context: { status: res.status, path },
            });
          }
          return res;
        } catch (error) {
          throw toUpstream(error, { url, path });
        } finally {
          clearTimeout(timer);
        }
      },
      {
        maxAttempts: attempts,
        baseDelayMs: 50,
        component: "adapters.reelmimic.http",
        onRetry: (attempt, error) => {
          log.warn("reelmimic.retry", {
            attempt,
            path,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      },
    );
  }

  async getJson<T = unknown>(path: string): Promise<T> {
    const res = await this.request(path, { method: "GET", idempotent: true });
    if (!res.ok) {
      throw new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: `ReelMimic GET ${path} failed with HTTP ${res.status}`,
        component: "adapters.reelmimic.http",
        retryable: res.status >= 500,
        context: { status: res.status, path },
      });
    }
    try {
      return (await res.json()) as T;
    } catch (error) {
      throw new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: "ReelMimic returned malformed JSON",
        component: "adapters.reelmimic.http",
        cause: error,
        context: { path },
      });
    }
  }

  async postJson<T = unknown>(path: string, body?: unknown, idempotent = false): Promise<T> {
    const res = await this.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      idempotent,
    });
    if (!res.ok) {
      let detail: unknown;
      try {
        detail = await res.json();
      } catch {
        detail = await res.text().catch(() => "");
      }
      throw new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: `ReelMimic POST ${path} failed with HTTP ${res.status}`,
        component: "adapters.reelmimic.http",
        retryable: res.status >= 500,
        context: { status: res.status, path, detail },
      });
    }
    try {
      return (await res.json()) as T;
    } catch (error) {
      throw new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: "ReelMimic POST returned malformed JSON",
        component: "adapters.reelmimic.http",
        cause: error,
        context: { path },
      });
    }
  }

  async postMultipart<T = unknown>(path: string, form: FormData): Promise<T> {
    const res = await this.request(path, {
      method: "POST",
      body: form,
      idempotent: false,
    });
    if (!res.ok) {
      let detail: unknown;
      try {
        detail = await res.json();
      } catch {
        detail = await res.text().catch(() => "");
      }
      throw new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: `ReelMimic multipart POST ${path} failed with HTTP ${res.status}`,
        component: "adapters.reelmimic.http",
        retryable: res.status >= 500,
        context: { status: res.status, path, detail },
      });
    }
    try {
      return (await res.json()) as T;
    } catch (error) {
      throw new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: "ReelMimic multipart response malformed",
        component: "adapters.reelmimic.http",
        cause: error,
        context: { path },
      });
    }
  }
}
