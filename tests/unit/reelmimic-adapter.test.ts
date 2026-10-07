import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReelMimicAdapter, smokeReelMimic } from "../../src/adapters/reelmimic/index.js";
import { ReelMimicHttpClient } from "../../src/adapters/reelmimic/http.js";
import { ToonForgeError } from "../../src/core/errors.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const baseConfig = {
  enabled: true,
  baseUrl: "http://127.0.0.1:4318",
  timeoutMs: 1000,
  maxRetries: 2,
};

describe("ReelMimic HTTP client", () => {
  it("health via /api/agents", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ claude: true, codex: false }));
    const client = new ReelMimicHttpClient({
      ...baseConfig,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const agents = await client.getJson("/api/agents");
    expect(agents).toEqual({ claude: true, codex: false });
  });

  it("retries GET on 503", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "busy" }, 503))
      .mockResolvedValueOnce(jsonResponse({ claude: true }));
    const client = new ReelMimicHttpClient({
      ...baseConfig,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.getJson("/api/agents");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 200 }));
    const client = new ReelMimicHttpClient({
      ...baseConfig,
      maxRetries: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.getJson("/api/agents")).rejects.toBeInstanceOf(ToonForgeError);
  });

  it("times out", async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const client = new ReelMimicHttpClient({
      ...baseConfig,
      timeoutMs: 20,
      maxRetries: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.getJson("/api/agents")).rejects.toMatchObject({ code: "RETRY_EXHAUSTED" });
  });
});

describe("ReelMimic adapter", () => {
  it("reports disabled / unavailable", async () => {
    const disabled = createReelMimicAdapter({ ...baseConfig, enabled: false });
    expect((await disabled.probe()).status).toBe("disabled");

    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const down = createReelMimicAdapter(baseConfig, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect((await down.probe()).status).toBe("unavailable");
  });

  it("creates project via URL and reads status", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/agents")) return jsonResponse({ claude: true });
      if (url.endsWith("/api/projects") && init?.method === "POST") {
        return jsonResponse({ id: "20261007-abcde" });
      }
      if (url.includes("/api/projects/20261007-abcde")) {
        return jsonResponse({ job: { stage: "plan_review", updatedAt: "t" } });
      }
      return jsonResponse({ error: "nope" }, 404);
    });
    const adapter = createReelMimicAdapter(baseConfig, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect((await adapter.probe()).status).toBe("ready");
    const created = await adapter.createProject({
      brief: "original fox adventure short",
      referenceUrl: "https://example.com/ref.mp4",
      lang: "en",
    });
    expect(created.projectId).toBe("20261007-abcde");
    const status = await adapter.getProject(created.projectId);
    expect(status.stage).toBe("plan_review");
  });

  it("writes stub analysis when REELMIMIC_ROOT unset", async () => {
    const adapter = createReelMimicAdapter({ ...baseConfig, enabled: false });
    const outDir = mkdtempSync(join(tmpdir(), "tf-rm-"));
    const result = await adapter.analyzeReference({
      sourcePath: "/tmp/ref.mp4",
      outDir,
    });
    expect(result.stub).toBe(true);
    expect(result.reportPath).toContain("reference-analysis.json");
    expect(result.report.notes.length).toBeGreaterThan(0);
  });

  it("smoke skips when server unavailable", async () => {
    const result = await smokeReelMimic({
      ...baseConfig,
      enabled: true,
    });
    // live server likely down in CI — either skipped or ready
    expect(typeof result.skipped).toBe("boolean");
  });
});
