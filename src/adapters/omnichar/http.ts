import { ToonForgeError } from "../../core/errors.js";
import { rootLogger } from "../../core/logging.js";
import { withRetry } from "../../core/retry.js";

export type FetchLike = typeof fetch;

export interface OmniCharHttpConfig {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl?: FetchLike;
}

export interface OmniCharHealth {
  ok: boolean;
  raw: unknown;
}

export interface OmniCharRpcResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: string;
}

const log = rootLogger.child("adapters.omnichar.http");

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    throw new ToonForgeError({
      code: "CONFIG_INVALID",
      message: `OmniChar base URL must be http(s): ${baseUrl}`,
      component: "adapters.omnichar.http",
    });
  }
  return trimmed;
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || error.name === "AbortError" || /timeout/i.test(error.message);
}

function toUpstreamError(error: unknown, context: Record<string, unknown>): ToonForgeError {
  if (error instanceof ToonForgeError) return error;
  const retryable =
    isTimeoutError(error) ||
    (error instanceof TypeError && /fetch|network|ECONNREFUSED|ENOTFOUND/i.test(error.message));
  return new ToonForgeError({
    code: "UPSTREAM_ERROR",
    message: error instanceof Error ? error.message : String(error),
    component: "adapters.omnichar.http",
    retryable,
    cause: error,
    context,
  });
}

export class OmniCharHttpClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: FetchLike;

  constructor(config: OmniCharHttpConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.timeoutMs = config.timeoutMs;
    this.maxRetries = Math.max(1, config.maxRetries);
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async request(
    path: string,
    init: RequestInit & { idempotent?: boolean } = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const idempotent = init.idempotent ?? (init.method === undefined || init.method === "GET");
    const attempts = idempotent ? this.maxRetries : 1;

    return withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const { idempotent: _ignored, signal: _userSignal, ...rest } = init;
          // Use adapter timeout only; callers that need composition can wrap fetchImpl.
          log.debug("omnichar.request", { url, method: rest.method ?? "GET" });
          const res = await this.fetchImpl(url, { ...rest, signal: controller.signal });
          if (res.status >= 500) {
            throw new ToonForgeError({
              code: "UPSTREAM_ERROR",
              message: `OmniChar HTTP ${res.status} for ${path}`,
              component: "adapters.omnichar.http",
              retryable: true,
              context: { status: res.status, path },
            });
          }
          return res;
        } catch (error) {
          throw toUpstreamError(error, { url, path });
        } finally {
          clearTimeout(timer);
        }
      },
      {
        maxAttempts: attempts,
        baseDelayMs: 50,
        component: "adapters.omnichar.http",
        onRetry: (attempt, error) => {
          log.warn("omnichar.retry", {
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
        message: `OmniChar GET ${path} failed with HTTP ${res.status}`,
        component: "adapters.omnichar.http",
        retryable: res.status >= 500,
        context: { status: res.status, path },
      });
    }
    try {
      return (await res.json()) as T;
    } catch (error) {
      throw new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: "OmniChar returned malformed JSON",
        component: "adapters.omnichar.http",
        retryable: false,
        cause: error,
        context: { path },
      });
    }
  }

  async health(): Promise<OmniCharHealth> {
    const raw = await this.getJson<unknown>("/v1/health");
    const ok =
      raw === true ||
      (typeof raw === "object" &&
        raw !== null &&
        (("ok" in raw && Boolean((raw as { ok?: unknown }).ok)) ||
          ("status" in raw && String((raw as { status?: unknown }).status).toLowerCase() === "ok") ||
          Object.keys(raw as object).length >= 0));
    return { ok: Boolean(ok), raw };
  }

  async listModels(): Promise<unknown> {
    return this.getJson("/v1/models");
  }

  async rpc<T = unknown>(channel: string, args: unknown[] = []): Promise<T> {
    const res = await this.request("/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel, args }),
      idempotent: channel === "characters:list",
    });
    let body: OmniCharRpcResult<T>;
    try {
      body = (await res.json()) as OmniCharRpcResult<T>;
    } catch (error) {
      throw new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: "OmniChar RPC returned malformed JSON",
        component: "adapters.omnichar.http",
        cause: error,
        context: { channel },
      });
    }
    if (!body || typeof body !== "object" || typeof body.ok !== "boolean") {
      throw new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: "OmniChar RPC response missing ok flag",
        component: "adapters.omnichar.http",
        context: { channel, body },
      });
    }
    if (!body.ok) {
      throw new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: body.error || `OmniChar RPC channel failed: ${channel}`,
        component: "adapters.omnichar.http",
        context: { channel },
      });
    }
    return body.value as T;
  }

  async uploadCharacter(bytes: Uint8Array, filename = "character.char"): Promise<{ file: string }> {
    const res = await this.request(`/upload/character?name=${encodeURIComponent(filename)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: bytes,
      idempotent: false,
    });
    let body: OmniCharRpcResult<{ file: string }>;
    try {
      body = (await res.json()) as OmniCharRpcResult<{ file: string }>;
    } catch (error) {
      throw new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: "OmniChar upload/character returned malformed JSON",
        component: "adapters.omnichar.http",
        cause: error,
      });
    }
    if (!body.ok || !body.value?.file) {
      throw new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: body.error || "OmniChar character upload failed",
        component: "adapters.omnichar.http",
        context: { body },
      });
    }
    return body.value;
  }

  async downloadCharacter(name: string): Promise<Uint8Array> {
    const res = await this.request(`/download/character/${encodeURIComponent(name)}`, {
      method: "GET",
      idempotent: true,
    });
    if (!res.ok) {
      throw new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: `OmniChar character download failed: HTTP ${res.status}`,
        component: "adapters.omnichar.http",
        retryable: res.status >= 500,
        context: { name, status: res.status },
      });
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}
