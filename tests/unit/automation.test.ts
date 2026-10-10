import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { liveOptInPath, resolvePublishMode } from "../../src/core/publish-mode.js";
import { loadRuntimeConfig } from "../../src/core/config.js";
import { assertSafeExternalUrl } from "../../src/core/security.js";
import { rootLogger } from "../../src/core/logging.js";
import { nextDailyUtc, parseDailyCron, zonedParts } from "../../src/scheduler/cron.js";
import { acquireSchedulerLock, releaseSchedulerLock } from "../../src/scheduler/store.js";
import { previewChannel, runSchedulerTick } from "../../src/scheduler/index.js";
import { assertLoopbackRedirect, connectYoutube, newOAuthState, waitForLoopbackCode } from "../../src/adapters/youtube/connect.js";
import { classifyYoutubeFailure, rememberChannel, youtubeStatus } from "../../src/adapters/youtube/account.js";
import { chatgptRemoteExample, clientTargetPath, cursorConfig, geminiConfig, mergeMcpServers } from "../../src/setup/clients.js";
import { dependencyExitCode, evaluateDependencies, versionSatisfies } from "../../src/setup/dependencies.js";
import { validateToolArgs } from "../../src/mcp/validate.js";
import { handleTool } from "../../src/mcp/handlers.js";
import { MCP_TOOL_NAMES, createToonForgeMcpServer } from "../../src/mcp/server.js";
import { createYoutubeAdapter } from "../../src/adapters/youtube/index.js";
import { manifestPath } from "../../src/adapters/youtube/manifest.js";
import { generateDevVideo } from "../../src/core/media.js";
import type { ChannelConfig } from "../../src/core/config.js";

function channel(partial: Partial<ChannelConfig> = {}): ChannelConfig {
  return {
    channel_id: "cartoon-default",
    channel_name: "Demo",
    niche: "cartoon",
    format: "shorts",
    schedule: { timezone: "UTC", cron: "0 6 * * *", enabled: true },
    characters: ["max"],
    style: "cartoon",
    duration_seconds: 45,
    max_daily_videos: 1,
    approval_mode: "manual",
    publishing_mode: "private",
    trend_sources: ["manual"],
    quality_threshold: 0.7,
    risk_threshold: 0.3,
    ...partial,
  };
}

describe("publish mode", () => {
  it("ignores a client request for live publishing unless the operator opted in", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-live-"));
    const config = loadRuntimeConfig({ YOUTUBE_DRY_RUN: "false", TOONFORGE_DATA_DIR: dataDir });
    const blocked = resolvePublishMode({ config, dataDir, requestedLive: true });
    expect(blocked.dryRun).toBe(true);
    expect(blocked.liveAllowed).toBe(false);
    writeFileSync(liveOptInPath(dataDir), JSON.stringify({ enabled: true, acknowledged: true, enabledAt: "2026-01-01T00:00:00Z" }));
    const allowed = resolvePublishMode({ config, dataDir, requestedLive: true });
    expect(allowed.dryRun).toBe(false);
  });
});

describe("scheduler", () => {
  it("keeps one occurrence across a daylight-saving fallback and skips a missing spring-forward time", () => {
    const cron = parseDailyCron("30 1 * * *");
    const duringFallback = nextDailyUtc(cron, "America/New_York", new Date("2026-11-01T04:00:00.000Z"));
    const wall = zonedParts(duringFallback, "America/New_York");
    expect(wall).toMatchObject({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 });
    const next = nextDailyUtc(cron, "America/New_York", duringFallback);
    expect(zonedParts(next, "America/New_York").day).toBe(2);

    const spring = parseDailyCron("30 2 * * *");
    const afterGap = nextDailyUtc(spring, "America/New_York", new Date("2026-03-08T05:00:00.000Z"));
    expect(zonedParts(afterGap, "America/New_York").day).toBe(9);
  });

  it("recovers a stale lock, refuses a live lock, and does not run when the kill switch is on", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-sched-"));
    acquireSchedulerLock(dataDir, "old", -1, new Date("2020-01-01T00:00:00Z"));
    acquireSchedulerLock(dataDir, "new", 1000, new Date());
    expect(() => acquireSchedulerLock(dataDir, "other", 1000, new Date())).toThrow(/lock/);
    releaseSchedulerLock(dataDir, "new");

    const config = loadRuntimeConfig({ TOONFORGE_KILL_SWITCH: "true", TOONFORGE_DATA_DIR: dataDir });
    let calls = 0;
    const due = new Date("2026-10-10T07:00:00.000Z");
    const result = await runSchedulerTick({
      dataDir,
      now: due,
      channels: [channel()],
      config,
      execute: async () => {
        calls += 1;
        return { state: "COMPLETE" };
      },
    });
    expect(calls).toBe(0);
    expect(result.skipped.length).toBe(1);
    const preview = previewChannel(channel({ schedule: { timezone: "UTC", cron: "0 6 * * *", enabled: false } }));
    expect(preview.nextRuns).toEqual([]);
  });

  it("does not enqueue a second job for the same local slot after a restart", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-restart-"));
    const config = loadRuntimeConfig({ TOONFORGE_DATA_DIR: dataDir, TOONFORGE_KILL_SWITCH: "false" });
    const now = new Date("2026-10-10T07:00:00.000Z");
    const first = await runSchedulerTick({
      dataDir,
      now,
      channels: [channel()],
      config,
      execute: async () => ({ state: "COMPLETE" }),
    });
    const second = await runSchedulerTick({
      dataDir,
      now: new Date(now.getTime() + 60_000),
      channels: [channel()],
      config,
      execute: async () => ({ state: "COMPLETE" }),
    });
    expect(first.ran).toHaveLength(1);
    expect(second.ran).toHaveLength(0);
  });
});

describe("youtube oauth loopback", () => {
  it("rejects a non-loopback redirect and a mismatched state", async () => {
    expect(() => assertLoopbackRedirect("https://example.com/callback")).toThrow(/loopback|http/);
    const state = newOAuthState();
    const pending = waitForLoopbackCode({ hostname: "127.0.0.1", port: 0, expectedState: state, timeoutMs: 200, path: "/" });
    await expect(pending).rejects.toThrow(/Timed out/);
  });

  it("accepts a matching state on an ephemeral port and stores a token without returning it", async () => {
    const state = newOAuthState();
    let bound = 0;
    const pending = waitForLoopbackCode({
      hostname: "127.0.0.1",
      port: 0,
      expectedState: state,
      timeoutMs: 2000,
      path: "/",
      onListening: (port) => {
        bound = port;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await fetch(`http://127.0.0.1:${bound}/?code=auth-code&state=${state}`);
    const result = await pending;
    expect(result.code).toBe("auth-code");

    const dataDir = mkdtempSync(join(tmpdir(), "tf-yt-"));
    const active = join(dataDir, "active-token.json");
    rememberChannel({
      dataDir,
      activeTokenPath: active,
      channelId: "UC_demo",
      title: "Demo",
      token: { refresh_token: "refresh-secret", access_token: "access-secret", scope: "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload" },
      scopes: ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/youtube.upload"],
    });
    expect(statSync(active).mode & 0o777).toBe(0o600);
    const config = loadRuntimeConfig({
      TOONFORGE_DATA_DIR: dataDir,
      YOUTUBE_CLIENT_ID: "client",
      YOUTUBE_CLIENT_SECRET: "secret",
      YOUTUBE_TOKEN_PATH: active,
    });
    const status = youtubeStatus(config, dataDir);
    expect(status.selectedChannelId).toBe("UC_demo");
    expect(JSON.stringify(status)).not.toContain("refresh-secret");
    expect(classifyYoutubeFailure("invalid_grant")).toMatchObject({ errorClass: "token_expired" });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("stores the channel chosen by the injected OAuth client", async () => {
    const connected = await connectYoutube({
      redirectUri: "http://127.0.0.1:53682/oauth",
      authorizationUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
      openBrowser: async (url) => {
        const parsed = new URL(url);
        const state = parsed.searchParams.get("state") ?? "";
        const target = `http://127.0.0.1:53682/oauth?code=from-test&state=${state}`;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          try {
            const response = await fetch(target);
            if (response.ok) return;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        }
        throw new Error("loopback did not accept the test callback");
      },
      exchangeCode: async () => ({ refresh_token: "r", scope: "https://www.googleapis.com/auth/youtube.readonly" }),
      listChannels: async () => [{ channelId: "UC_a", title: "A" }, { channelId: "UC_b", title: "B" }],
      selectChannelId: "UC_b",
    });
    expect(connected.channel.channelId).toBe("UC_b");
    expect(connected.token.refresh_token).toBe("r");
  });
});

describe("client config and dependencies", () => {
  it("merges a cursor server without dropping other servers or writing secrets", () => {
    const merged = mergeMcpServers(JSON.stringify({ mcpServers: { other: { command: "keep" } } }), {
      command: "toonforge",
      args: ["mcp"],
      env: { YOUTUBE_DRY_RUN: "true" },
    });
    const parsed = JSON.parse(merged) as { mcpServers: Record<string, { command: string }> };
    expect(parsed.mcpServers.other?.command).toBe("keep");
    expect(parsed.mcpServers.toonforge?.command).toBe("toonforge");
    expect(merged).not.toMatch(/sk-|api_key/i);
  });

  it("keeps ChatGPT remote and writes no secrets into Cursor, Gemini, or Claude configs", () => {
    for (const file of [".cursor/mcp.json", ".gemini/settings.json", ".mcp.json", "config/clients/cursor.mcp.json", "config/clients/gemini.settings.json"]) {
      const raw = readFileSync(join(process.cwd(), file), "utf8");
      const parsed = JSON.parse(raw) as { mcpServers: { toonforge: { command: string } } };
      expect(parsed.mcpServers.toonforge.command).toMatch(/^(node|toonforge)$/);
      expect(raw).not.toMatch(/client_secret|refresh_token|BEGIN PRIVATE|sk-/i);
    }
    expect(clientTargetPath("cursor", "/home/demo", "linux")).toBe("/home/demo/.cursor/mcp.json");
    expect(clientTargetPath("gemini", "/home/demo", "linux")).toBe("/home/demo/.gemini/settings.json");
    expect(clientTargetPath("claude", "/home/demo", "darwin")).toContain("Claude");
    expect(clientTargetPath("claude", "/home/demo", "win32")).toContain("Claude");
    expect(clientTargetPath("chatgpt", "/home/demo", "linux")).toBeNull();
    const remote = chatgptRemoteExample("https://example.com/mcp");
    expect(remote).toContain("streamable-http");
    expect(JSON.parse(cursorConfig()).mcpServers.toonforge.args).toEqual(["mcp"]);
    expect(JSON.parse(geminiConfig()).mcpServers.toonforge.command).toBe("toonforge");
  });

  it("fails closed when a required command is missing and passes a sufficient node version", async () => {
    expect(versionSatisfies("v22.14.0", ">=22.14.0")).toBe(true);
    expect(versionSatisfies("v22.13.0", ">=22.14.0")).toBe(false);
    const checks = await evaluateDependencies({
      platform: "linux",
      specs: [
        {
          id: "node",
          required: true,
          platforms: ["linux"],
          versionRange: ">=22.14.0",
          detect: { command: "node", args: ["-v"] },
          why: "runtime",
          license: "MIT",
          install: { linux: "install node" },
        },
        {
          id: "ffmpeg",
          required: true,
          platforms: ["linux"],
          detect: { command: "ffmpeg", args: ["-version"] },
          why: "media",
          license: "varies",
          install: { linux: "install ffmpeg" },
        },
      ],
      run: async (command) => command === "node"
        ? { ok: true, output: "v22.14.0" }
        : { ok: false, output: "not found" },
    });
    expect(dependencyExitCode(checks)).toBe(2);
  });
});

describe("mcp contract", () => {
  it("rejects invalid publish arguments and does not let dryRun false go live", async () => {
    expect(MCP_TOOL_NAMES).toContain("toonforge.publish_preflight");
    expect(() => validateToolArgs("toonforge.publish_video", { dryRun: false }, 1000)).toThrow(/validation/i);
    const preflight = await handleTool("toonforge.publish_preflight", {}) as { liveAllowed: boolean; blockers: string[] };
    expect(preflight.liveAllowed).toBe(false);
    expect(preflight.blockers.length).toBeGreaterThan(0);
    const server = createToonForgeMcpServer();
    expect(server).toBeTruthy();
  });

  it("redacts secrets from logs and blocks private URLs", () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      rootLogger.info("hello", { token: "super-secret", note: "Bearer abc.def" });
    } finally {
      console.error = original;
    }
    expect(lines.join("\n")).not.toContain("super-secret");
    expect(lines.join("\n")).not.toContain("abc.def");
    expect(() => assertSafeExternalUrl("http://127.0.0.1/secret")).toThrow(/Blocked/);
    expect(() => assertSafeExternalUrl("http://192.168.1.5/a")).toThrow(/Blocked/);
  });
});

describe("youtube reconciliation", () => {
  it("does not upload again when the previous attempt needs reconciliation", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-recon-"));
    const video = join(dataDir, "video.mp4");
    await generateDevVideo({ outPath: video, durationSec: 1, withAudio: true, label: "gate" });
    const { mkdirSync } = await import("node:fs");
    const manifest = manifestPath(dataDir, "pub:p:v");
    mkdirSync(join(dataDir, "publish-manifests"), { recursive: true });
    writeFileSync(manifest, JSON.stringify({
      projectId: "p",
      videoId: "v",
      referenceIds: [],
      characterIds: [],
      artifacts: { videoPath: video },
      hashes: { video: "abc" },
      qaResult: "PASS",
      policyResult: "PASS",
      provenance: { originalContent: true, thirdPartyFootage: false, licensedAssets: [], notes: [] },
      timestamp: new Date().toISOString(),
      publishStatus: "reconciliation_required",
      idempotencyKey: "pub:p:v",
    }));
    let uploads = 0;
    const adapter = createYoutubeAdapter({
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "http://127.0.0.1:53682/",
      tokenPath: join(dataDir, "token.json"),
      defaultPrivacy: "private",
      dryRunDefault: false,
    }, {
      dataDir,
      apiClient: {
        async uploadVideo() {
          uploads += 1;
          return { youtubeId: "new" };
        },
        async setThumbnail() {},
        async updateVideo() {},
        async getVideo() { return {}; },
        async getAnalytics() { return {}; },
      },
    });
    const result = await adapter.publish({
      idempotencyKey: "pub:p:v",
      projectId: "p",
      videoId: "v",
      videoPath: video,
      dryRun: true,
      workflowState: "READY_TO_PUBLISH",
      qaStatus: "PASS",
      policyStatus: "PASS",
      metadata: { title: "t", description: "d", privacyStatus: "private" },
    });
    expect(result.status).toBe("reconciliation_required");
    expect(uploads).toBe(0);
  });
});

