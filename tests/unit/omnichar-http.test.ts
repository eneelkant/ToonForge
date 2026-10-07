import { describe, expect, it, vi } from "vitest";
import { createOmniCharAdapter } from "../../src/adapters/omnichar/index.js";
import { OmniCharHttpClient } from "../../src/adapters/omnichar/http.js";
import { ToonForgeError } from "../../src/core/errors.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OmniChar HTTP client", () => {
  it("loads health successfully", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "ok" }));
    const client = new OmniCharHttpClient({
      baseUrl: "http://127.0.0.1:8848",
      timeoutMs: 1000,
      maxRetries: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const health = await client.health();
    expect(health.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("retries idempotent GET on 503 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "busy" }, 503))
      .mockResolvedValueOnce(jsonResponse({ status: "ok" }));
    const client = new OmniCharHttpClient({
      baseUrl: "http://127.0.0.1:8848",
      timeoutMs: 1000,
      maxRetries: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const health = await client.health();
    expect(health.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("maps connection failure to retryable upstream error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const client = new OmniCharHttpClient({
      baseUrl: "http://127.0.0.1:8848",
      timeoutMs: 100,
      maxRetries: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.health()).rejects.toMatchObject({
      code: "RETRY_EXHAUSTED",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("not-json", { status: 200 }));
    const client = new OmniCharHttpClient({
      baseUrl: "http://127.0.0.1:8848",
      timeoutMs: 1000,
      maxRetries: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.health()).rejects.toBeInstanceOf(ToonForgeError);
  });

  it("rejects invalid base URL configuration", () => {
    expect(
      () =>
        new OmniCharHttpClient({
          baseUrl: "not-a-url",
          timeoutMs: 1000,
          maxRetries: 1,
        }),
    ).toThrow(/http\(s\)/);
  });

  it("times out long requests", async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        }),
    );
    const client = new OmniCharHttpClient({
      baseUrl: "http://127.0.0.1:8848",
      timeoutMs: 20,
      maxRetries: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.health()).rejects.toMatchObject({ code: "RETRY_EXHAUSTED" });
  });

  it("calls characters:list via RPC", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ok: true,
        value: [{ file: "Max.char", name: "Max", needsRebuild: false, refs: 2 }],
      }),
    );
    const client = new OmniCharHttpClient({
      baseUrl: "http://127.0.0.1:8848",
      timeoutMs: 1000,
      maxRetries: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const list = await client.rpc("characters:list", []);
    expect(list).toEqual([{ file: "Max.char", name: "Max", needsRebuild: false, refs: 2 }]);
  });
});

describe("OmniChar adapter", () => {
  const baseConfig = {
    enabled: true,
    baseUrl: "http://127.0.0.1:8848",
    timeoutMs: 1000,
    maxRetries: 2,
  };

  it("reports unavailable when OmniChar is down", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const adapter = createOmniCharAdapter(baseConfig, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const probe = await adapter.probe();
    expect(probe.status).toBe("unavailable");
  });

  it("reports disabled when not enabled", async () => {
    const adapter = createOmniCharAdapter({ ...baseConfig, enabled: false });
    expect(await adapter.probe()).toEqual({
      status: "disabled",
      detail: "OMNICHAR_ENABLED is not true",
    });
    await expect(adapter.listCharacters()).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
  });

  it("lists and validates characters", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/health")) return jsonResponse({ status: "ok" });
      if (url.endsWith("/rpc")) {
        return jsonResponse({
          ok: true,
          value: [{ file: "Max.char", name: "Max", needsRebuild: true, refs: 1 }],
        });
      }
      return jsonResponse({ error: "nope" }, 404);
    });
    const adapter = createOmniCharAdapter(baseConfig, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect((await adapter.probe()).status).toBe("ready");
    const list = await adapter.listCharacters();
    expect(list[0]?.file).toBe("Max.char");
    const continuity = await adapter.validateContinuity("Max");
    expect(continuity.ok).toBe(false);
    expect(continuity.needsRebuild).toBe(true);
  });

  it("encodes from take via RPC", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, value: { file: "Bolt.char", name: "Bolt", refs: 1 } }),
    );
    const adapter = createOmniCharAdapter(baseConfig, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await adapter.encodeFromTake("take_1", "Bolt");
    expect(result.method).toBe("createFromTake");
    expect(result.file).toBe("Bolt.char");
  });

  it("uploads a .char file", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/upload/character")) {
        return jsonResponse({ ok: true, value: { file: "Milo.char" } });
      }
      if (url.endsWith("/rpc")) {
        return jsonResponse({
          ok: true,
          value: [{ file: "Milo.char", name: "Milo", needsRebuild: false }],
        });
      }
      return jsonResponse({}, 404);
    });
    const adapter = createOmniCharAdapter(baseConfig, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await adapter.uploadCharFile(new Uint8Array([1, 2, 3]), "Milo.char");
    expect(result.file).toBe("Milo.char");
    expect(result.method).toBe("upload");
  });
});
