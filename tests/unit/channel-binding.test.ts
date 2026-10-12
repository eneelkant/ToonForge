import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadAccounts, rememberChannel, saveAccounts, type YoutubeChannelRecord } from "../../src/adapters/youtube/account.js";
import {
  assertChannelBinding,
  evaluateChannelBinding,
} from "../../src/adapters/youtube/channel-binding.js";
import { CANONICAL_YOUTUBE_REDIRECT_URI, assertLoopbackRedirect } from "../../src/adapters/youtube/connect.js";
import { createYoutubeAdapter } from "../../src/adapters/youtube/index.js";
import type { YoutubeApiClient, YoutubeUploadRequest } from "../../src/adapters/youtube/types.js";
import { loadChannelConfig, loadRuntimeConfig, type ChannelConfig } from "../../src/core/config.js";
import { generateDevVideo, writeMediaSidecar } from "../../src/core/media.js";
import { liveOptInPath } from "../../src/core/publish-mode.js";
import { publishPreflight } from "../../src/engines/publish/preflight.js";
import { publicErrorText, workflowProcessCode } from "../../src/engines/workflow/result.js";
import { handleTool } from "../../src/mcp/handlers.js";
import { toolCallResponse, toolFailureResponse } from "../../src/mcp/server.js";
import { runSchedulerTick } from "../../src/scheduler/index.js";
import { loadState } from "../../src/scheduler/store.js";

const TARGET = "UCFW402c826AbgWKtKs_uAyw";
const OTHER = "UCotherchannelid00000000";
const STALE = "UCstalechannelid00000000";

const media: { videoPath: string } = { videoPath: "" };

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-bind-media-"));
  media.videoPath = join(dir, "out.mp4");
  await generateDevVideo({ outPath: media.videoPath, durationSec: 1, withAudio: true });
  writeMediaSidecar(media.videoPath, { kind: "ffmpeg_dev" });
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

function record(channelId: string): YoutubeChannelRecord {
  return {
    channelId,
    title: "Fixture",
    tokenFile: "unused-token.json",
    authorizedAt: "2026-01-01T00:00:00.000Z",
    scopes: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube.upload",
    ],
  };
}

function accounts(selected: string | undefined, ids: string[]) {
  return {
    selectedChannelId: selected,
    channels: ids.map(record),
  };
}

function selectChannel(dataDir: string, channelId: string): void {
  rememberChannel({
    dataDir,
    activeTokenPath: join(dataDir, "active-token.json"),
    channelId,
    title: "Fixture",
    token: { access_token: "fixture-access", refresh_token: "fixture-refresh" },
    scopes: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube.upload",
    ],
  });
}

function writeChannelFile(
  path: string,
  options: { youtubeId?: string; scheduleEnabled?: boolean; backend?: "offline_fixture" | "reelmimic" | "openmontage" } = {},
): void {
  const lines = [
    "channel_id: binding-test",
    "channel_name: Binding Test",
    "niche: cartoon",
    "format: shorts",
    "schedule:",
    "  timezone: UTC",
    '  cron: "0 6 * * *"',
    `  enabled: ${options.scheduleEnabled === true}`,
    "characters:",
    "  - max",
    "style: cartoon",
    "duration_seconds: 45",
    "max_daily_videos: 1",
    "approval_mode: manual",
    "publishing_mode: private",
  ];
  if (options.youtubeId) lines.push(`youtube_channel_id: ${options.youtubeId}`);
  if (options.backend) lines.push(`production_backend: ${options.backend}`);
  lines.push("trend_sources:", "  - manual", "quality_threshold: 0.7", "risk_threshold: 0.3", "");
  writeFileSync(path, lines.join("\n"));
}

function youtubeConfig(overrides: { clientId?: string; clientSecret?: string; dryRunDefault?: boolean } = {}) {
  return {
    clientId: overrides.clientId === undefined ? "fixture-client" : overrides.clientId,
    clientSecret: overrides.clientSecret === undefined ? "fixture-secret" : overrides.clientSecret,
    redirectUri: CANONICAL_YOUTUBE_REDIRECT_URI,
    tokenPath: "./data/youtube-token.json",
    defaultPrivacy: "private" as const,
    dryRunDefault: overrides.dryRunDefault ?? false,
  };
}

function mockApi(): YoutubeApiClient {
  return {
    uploadVideo: vi.fn(async () => ({ youtubeId: "yt_should_not_matter" })),
    setThumbnail: vi.fn(async () => undefined),
    updateVideo: vi.fn(async () => undefined),
    getVideo: vi.fn(async () => ({})),
    getAnalytics: vi.fn(async () => ({})),
  };
}

function request(idempotencyKey: string, extra: Partial<YoutubeUploadRequest> = {}): YoutubeUploadRequest {
  return {
    idempotencyKey,
    projectId: "p-bind",
    videoId: "v-bind",
    videoPath: media.videoPath,
    dryRun: false,
    workflowState: "READY_TO_PUBLISH",
    qaStatus: "PASS",
    policyStatus: "PASS",
    metadata: { title: "Binding check", description: "Original cartoon", privacyStatus: "private" },
    provenance: { originalContent: true, thirdPartyFootage: false, licensedAssets: [], notes: [] },
    ...extra,
  };
}

function assertNoSecrets(text: string): void {
  expect(text).not.toMatch(/fixture-access|fixture-refresh|fixture-secret|ya29\.|GOCSPX-/);
}

function channel(partial: Partial<ChannelConfig> = {}): ChannelConfig {
  return {
    channel_id: "binding-test",
    channel_name: "Binding Test",
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

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli/index.ts", ...args], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function isolatedEnv(dataDir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TOONFORGE_DATA_DIR: dataDir,
    TOONFORGE_KILL_SWITCH: "false",
    YOUTUBE_DRY_RUN: "true",
    YOUTUBE_CLIENT_ID: "",
    YOUTUBE_CLIENT_SECRET: "",
    YOUTUBE_CHANNEL_ID: "",
    YOUTUBE_REDIRECT_URI: "",
    YOUTUBE_TOKEN_PATH: join(dataDir, "active-token.json"),
    ...extra,
  };
}

describe("channel binding decision", () => {
  it("accepts a configured target that matches the stored authenticated channel", () => {
    const binding = evaluateChannelBinding({
      channelYoutubeId: TARGET,
      envYoutubeId: TARGET,
      accounts: accounts(TARGET, [TARGET]),
    });
    expect(binding).toEqual({ ok: true, targetChannelId: TARGET, authenticatedChannelId: TARGET });
  });

  it("rejects an authenticated channel that differs from the configured target", () => {
    expect(() => assertChannelBinding({
      channelYoutubeId: TARGET,
      accounts: accounts(OTHER, [OTHER, TARGET]),
    })).toThrow(expect.objectContaining({
      code: "POLICY_VIOLATION",
      context: { blocker: "channel_mismatch" },
    }));
  });

  it("rejects a missing target channel id", () => {
    expect(() => assertChannelBinding({ accounts: accounts(TARGET, [TARGET]) })).toThrow(expect.objectContaining({
      code: "CONFIG_INVALID",
      context: { blocker: "target_channel_missing" },
    }));
  });

  it("rejects a missing authenticated channel and a stale selected id with no record", () => {
    expect(evaluateChannelBinding({
      envYoutubeId: TARGET,
      accounts: accounts(undefined, []),
    })).toMatchObject({ ok: false, blocker: "authenticated_channel_missing" });
    expect(evaluateChannelBinding({
      envYoutubeId: TARGET,
      accounts: accounts(STALE, [TARGET]),
    })).toMatchObject({ ok: false, blocker: "authenticated_channel_missing" });
  });

  it("rejects an invalid target and an ambiguous target", () => {
    expect(evaluateChannelBinding({
      envYoutubeId: "not-a-channel",
      accounts: accounts(TARGET, [TARGET]),
    })).toMatchObject({ ok: false, blocker: "target_channel_invalid" });
    expect(evaluateChannelBinding({
      channelYoutubeId: TARGET,
      envYoutubeId: OTHER,
      accounts: accounts(TARGET, [TARGET]),
    })).toMatchObject({ ok: false, blocker: "target_channel_ambiguous" });
  });

  it("uses the canonical loopback redirect and rejects the bare default that used to ship", () => {
    expect(loadRuntimeConfig({}).youtube.redirectUri).toBe(CANONICAL_YOUTUBE_REDIRECT_URI);
    expect(assertLoopbackRedirect(CANONICAL_YOUTUBE_REDIRECT_URI).href).toBe("http://127.0.0.1:53682/");
    expect(() => assertLoopbackRedirect("http://127.0.0.1/")).toThrow(/non-privileged/);
    expect(() => assertLoopbackRedirect("http://127.0.0.1:80/")).toThrow(/non-privileged/);
  });
});

describe("publish path channel gate", () => {
  function production(): void {
    writeMediaSidecar(media.videoPath, { kind: "reelmimic", provider: "reelmimic" });
  }

  it("uploads once when the stored channel matches the target", async () => {
    production();
    const dataDir = mkdtempSync(join(tmpdir(), "tf-bind-ok-"));
    selectChannel(dataDir, TARGET);
    const api = mockApi();
    const yt = createYoutubeAdapter(youtubeConfig(), {
      dataDir,
      apiClient: api,
      dryRunDefault: false,
      envTargetChannelId: TARGET,
    });
    const result = await yt.publish(request("pub:bind:match"));
    expect(result.status).toBe("published");
    expect(api.uploadVideo).toHaveBeenCalledOnce();
  }, 30_000);

  it("does not upload when the authenticated channel differs, including a caller-supplied id", async () => {
    production();
    const dataDir = mkdtempSync(join(tmpdir(), "tf-bind-miss-"));
    selectChannel(dataDir, OTHER);
    const api = mockApi();
    const yt = createYoutubeAdapter(youtubeConfig(), {
      dataDir,
      apiClient: api,
      dryRunDefault: false,
      envTargetChannelId: TARGET,
    });
    const claimed = { ...request("pub:bind:mismatch"), claimedChannelId: TARGET };
    const error = await yt.publish(claimed).then(() => null, (err: unknown) => err);
    expect(error).toMatchObject({
      code: "POLICY_VIOLATION",
      context: { blocker: "channel_mismatch" },
    });
    expect((error as Error).message).toContain("Refusing to upload");
    assertNoSecrets((error as Error).message);
    expect(api.uploadVideo).not.toHaveBeenCalled();
  }, 30_000);

  it("does not upload when the target is missing, invalid, or ambiguous", async () => {
    production();
    const cases = [
      { key: "missing", env: undefined as string | undefined, blocker: "target_channel_missing", code: "CONFIG_INVALID" },
      { key: "invalid", env: "not-a-channel", blocker: "target_channel_invalid", code: "CONFIG_INVALID" },
      { key: "ambiguous", env: OTHER, channelYoutubeId: TARGET, blocker: "target_channel_ambiguous", code: "CONFIG_INVALID" },
    ];
    for (const item of cases) {
      const dataDir = mkdtempSync(join(tmpdir(), `tf-bind-${item.key}-`));
      selectChannel(dataDir, TARGET);
      const api = mockApi();
      const yt = createYoutubeAdapter(youtubeConfig(), {
        dataDir,
        apiClient: api,
        dryRunDefault: false,
        channelYoutubeId: item.channelYoutubeId,
        envTargetChannelId: item.env,
      });
      const error = await yt.publish(request(`pub:bind:${item.key}`)).then(() => null, (err: unknown) => err);
      expect(error).toMatchObject({ code: item.code, context: { blocker: item.blocker } });
      assertNoSecrets((error as Error).message);
      expect(api.uploadVideo).not.toHaveBeenCalled();
    }
  }, 30_000);

  it("does not upload when no authenticated channel record is selected", async () => {
    production();
    const dataDir = mkdtempSync(join(tmpdir(), "tf-bind-anon-"));
    const api = mockApi();
    const yt = createYoutubeAdapter(youtubeConfig(), {
      dataDir,
      apiClient: api,
      dryRunDefault: false,
      envTargetChannelId: TARGET,
    });
    const error = await yt.publish(request("pub:bind:anon")).then(() => null, (err: unknown) => err);
    expect(error).toMatchObject({
      code: "POLICY_VIOLATION",
      context: { blocker: "authenticated_channel_missing" },
    });
    expect(api.uploadVideo).not.toHaveBeenCalled();
  }, 30_000);

  it("re-reads a changed selected channel and a rewritten channel file before upload", async () => {
    production();
    const dataDir = mkdtempSync(join(tmpdir(), "tf-bind-stale-"));
    selectChannel(dataDir, TARGET);
    expect(evaluateChannelBinding({
      envYoutubeId: TARGET,
      accounts: loadAccounts(dataDir),
    }).ok).toBe(true);
    const stale = loadAccounts(dataDir);
    stale.selectedChannelId = STALE;
    saveAccounts(dataDir, stale);
    const api = mockApi();
    const staleAdapter = createYoutubeAdapter(youtubeConfig(), {
      dataDir,
      apiClient: api,
      dryRunDefault: false,
      envTargetChannelId: TARGET,
    });
    const staleError = await staleAdapter.publish(request("pub:bind:stale")).then(() => null, (err: unknown) => err);
    expect(staleError).toMatchObject({ context: { blocker: "authenticated_channel_missing" } });
    expect(api.uploadVideo).not.toHaveBeenCalled();

    const switched = mkdtempSync(join(tmpdir(), "tf-bind-switch-"));
    selectChannel(switched, TARGET);
    selectChannel(switched, OTHER);
    const switchedApi = mockApi();
    const switchedAdapter = createYoutubeAdapter(youtubeConfig(), {
      dataDir: switched,
      apiClient: switchedApi,
      dryRunDefault: false,
      envTargetChannelId: TARGET,
    });
    const switchedError = await switchedAdapter.publish(request("pub:bind:switch")).then(() => null, (err: unknown) => err);
    expect(switchedError).toMatchObject({ context: { blocker: "channel_mismatch" } });
    expect(switchedApi.uploadVideo).not.toHaveBeenCalled();

    const rewritten = mkdtempSync(join(tmpdir(), "tf-bind-rewrite-"));
    const channelPath = join(rewritten, "channel.yaml");
    writeChannelFile(channelPath, { youtubeId: TARGET });
    selectChannel(rewritten, TARGET);
    writeChannelFile(channelPath, { youtubeId: OTHER });
    const rewriteApi = mockApi();
    const rewriteAdapter = createYoutubeAdapter(youtubeConfig(), {
      dataDir: rewritten,
      apiClient: rewriteApi,
      dryRunDefault: false,
      channelPath,
    });
    const rewriteError = await rewriteAdapter.publish(request("pub:bind:rewrite")).then(() => null, (err: unknown) => err);
    expect(rewriteError).toMatchObject({ code: "POLICY_VIOLATION", context: { blocker: "channel_mismatch" } });
    expect(rewriteApi.uploadVideo).not.toHaveBeenCalled();
  }, 30_000);

  it("performs no upload on dry-run, QA failure, fixture media, or missing OAuth", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-bind-block-"));
    selectChannel(dataDir, OTHER);
    const dryApi = mockApi();
    const dry = createYoutubeAdapter(youtubeConfig({ dryRunDefault: true }), {
      dataDir,
      apiClient: dryApi,
      dryRunDefault: true,
      envTargetChannelId: TARGET,
    });
    const dryResult = await dry.publish(request("pub:bind:dry", { dryRun: true }));
    expect(dryResult.status).toBe("dry_run");
    expect(dryApi.uploadVideo).not.toHaveBeenCalled();

    writeMediaSidecar(media.videoPath, { kind: "ffmpeg_dev" });
    const qaApi = mockApi();
    const qa = createYoutubeAdapter(youtubeConfig(), { dataDir, apiClient: qaApi, dryRunDefault: false, envTargetChannelId: TARGET });
    const qaError = await qa.publish(request("pub:bind:qa", { qaStatus: "FAIL" })).then(() => null, (err: unknown) => err);
    expect(qaError).toMatchObject({ code: "QA_BLOCK" });
    expect(qaApi.uploadVideo).not.toHaveBeenCalled();

    const fixtureApi = mockApi();
    const fixture = createYoutubeAdapter(youtubeConfig(), { dataDir, apiClient: fixtureApi, dryRunDefault: false, envTargetChannelId: TARGET });
    const fixtureError = await fixture.publish(request("pub:bind:fixture")).then(() => null, (err: unknown) => err);
    expect(fixtureError).toMatchObject({ code: "POLICY_VIOLATION" });
    expect(String((fixtureError as Error).message)).toMatch(/ffmpeg_dev|fixture/);
    expect(fixtureApi.uploadVideo).not.toHaveBeenCalled();

    writeMediaSidecar(media.videoPath, { kind: "reelmimic", provider: "reelmimic" });
    const oauthApi = mockApi();
    const oauth = createYoutubeAdapter(youtubeConfig({ clientId: "", clientSecret: "" }), {
      dataDir,
      apiClient: oauthApi,
      dryRunDefault: false,
      envTargetChannelId: TARGET,
    });
    const oauthError = await oauth.publish(request("pub:bind:oauth")).then(() => null, (err: unknown) => err);
    expect(oauthError).toMatchObject({ code: "CONFIG_INVALID" });
    expect(String((oauthError as Error).message)).toMatch(/YOUTUBE_CLIENT_ID/);
    expect(oauthApi.uploadVideo).not.toHaveBeenCalled();
  }, 30_000);
});

describe("channel binding callers", () => {
  it("reports a match only when the target, token, redirect, and live gate all agree", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-bind-pre-ok-"));
    const channelPath = join(dataDir, "channel.yaml");
    writeChannelFile(channelPath, { youtubeId: TARGET, scheduleEnabled: true, backend: "openmontage" });
    selectChannel(dataDir, TARGET);
    writeFileSync(liveOptInPath(dataDir), JSON.stringify({ enabled: true, acknowledged: true, enabledAt: "2026-01-01T00:00:00.000Z" }));
    const config = loadRuntimeConfig({
      TOONFORGE_DATA_DIR: dataDir,
      TOONFORGE_KILL_SWITCH: "false",
      YOUTUBE_DRY_RUN: "false",
      YOUTUBE_CLIENT_ID: "fixture-client",
      YOUTUBE_CLIENT_SECRET: "fixture-secret",
      YOUTUBE_CHANNEL_ID: TARGET,
      YOUTUBE_REDIRECT_URI: CANONICAL_YOUTUBE_REDIRECT_URI,
      YOUTUBE_TOKEN_PATH: join(dataDir, "active-token.json"),
    });
    const report = publishPreflight(config, loadChannelConfig(channelPath));
    expect(report.channelBinding).toBe("match");
    expect(report.targetChannelId).toBe(TARGET);
    expect(report.redirectUri).toBe(CANONICAL_YOUTUBE_REDIRECT_URI);
    expect(report.blockers).toEqual([]);
    expect(report.liveAllowed).toBe(true);
  });

  it("blocks preflight on a mismatch, a missing target, and an invalid redirect", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-bind-pre-bad-"));
    const channelPath = join(dataDir, "channel.yaml");
    writeChannelFile(channelPath, { youtubeId: TARGET });
    selectChannel(dataDir, OTHER);
    const config = loadRuntimeConfig({
      TOONFORGE_DATA_DIR: dataDir,
      YOUTUBE_REDIRECT_URI: "http://127.0.0.1/",
      YOUTUBE_TOKEN_PATH: join(dataDir, "active-token.json"),
    });
    const mismatch = publishPreflight(config, loadChannelConfig(channelPath));
    expect(mismatch.channelBinding).toBe("channel_mismatch");
    expect(mismatch.liveAllowed).toBe(false);
    expect(mismatch.blockers).toContain("channel_mismatch");
    expect(mismatch.blockers).toContain("redirect_invalid");

    writeChannelFile(channelPath);
    const missing = publishPreflight(config, loadChannelConfig(channelPath));
    expect(missing.channelBinding).toBe("target_channel_missing");
    expect(missing.liveAllowed).toBe(false);
  });

  it("exits nonzero from the CLI when preflight identity does not match", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-bind-cli-"));
    const channelPath = join(dataDir, "channel.yaml");
    writeChannelFile(channelPath, { youtubeId: TARGET });
    selectChannel(dataDir, OTHER);
    const mismatch = await runCli(["publish", "preflight", "--channel-config", channelPath], isolatedEnv(dataDir));
    const mismatchJson = JSON.parse(mismatch.stdout.slice(mismatch.stdout.indexOf("{"))) as {
      channelBinding: string;
      liveAllowed: boolean;
    };
    expect(mismatch.code).toBe(1);
    expect(mismatch.stderr).toContain("publish preflight failed: channel_mismatch");
    expect(mismatchJson.channelBinding).toBe("channel_mismatch");
    expect(mismatchJson.liveAllowed).toBe(false);
    assertNoSecrets(mismatch.stdout + mismatch.stderr);

    writeChannelFile(channelPath);
    const missing = await runCli(["publish", "preflight", "--channel-config", channelPath], isolatedEnv(dataDir));
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("publish preflight failed: target_channel_missing");

    writeChannelFile(channelPath, { youtubeId: TARGET });
    selectChannel(dataDir, TARGET);
    const redirect = await runCli(
      ["publish", "preflight", "--channel-config", channelPath],
      isolatedEnv(dataDir, { YOUTUBE_REDIRECT_URI: "http://127.0.0.1/" }),
    );
    const redirectJson = JSON.parse(redirect.stdout.slice(redirect.stdout.indexOf("{"))) as {
      channelBinding: string;
      blockers: string[];
      redirectUri: string;
    };
    expect(redirect.code).toBe(0);
    expect(redirectJson.channelBinding).toBe("match");
    expect(redirectJson.blockers).toContain("redirect_invalid");
    expect(redirectJson.redirectUri).toBe("http://127.0.0.1/");
  }, 30_000);

  it("propagates a mismatch through MCP preflight and publish without an upload client", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-bind-mcp-"));
    const channelPath = join(dataDir, "channel.yaml");
    writeChannelFile(channelPath, { youtubeId: TARGET });
    selectChannel(dataDir, OTHER);
    vi.stubEnv("TOONFORGE_DATA_DIR", dataDir);
    vi.stubEnv("TOONFORGE_KILL_SWITCH", "false");
    vi.stubEnv("YOUTUBE_DRY_RUN", "false");
    vi.stubEnv("YOUTUBE_CLIENT_ID", "fixture-client");
    vi.stubEnv("YOUTUBE_CLIENT_SECRET", "fixture-secret");
    vi.stubEnv("YOUTUBE_CHANNEL_ID", "");
    vi.stubEnv("YOUTUBE_REDIRECT_URI", CANONICAL_YOUTUBE_REDIRECT_URI);
    vi.stubEnv("YOUTUBE_TOKEN_PATH", join(dataDir, "active-token.json"));
    writeFileSync(liveOptInPath(dataDir), JSON.stringify({ enabled: true, acknowledged: true, enabledAt: "2026-01-01T00:00:00.000Z" }));
    writeMediaSidecar(media.videoPath, { kind: "reelmimic", provider: "reelmimic" });

    const preflight = await handleTool("toonforge.publish_preflight", { channelPath }) as {
      channelBinding: string;
      liveAllowed: boolean;
      blockers: string[];
    };
    expect(preflight.channelBinding).toBe("channel_mismatch");
    expect(preflight.liveAllowed).toBe(false);
    expect(preflight.blockers).toContain("channel_mismatch");

    const error = await handleTool("toonforge.publish_video", {
      projectId: "p-mcp",
      videoId: "v-mcp",
      videoPath: media.videoPath,
      idempotencyKey: "pub:mcp:mismatch",
      dryRun: false,
      workflowState: "READY_TO_PUBLISH",
      qaStatus: "PASS",
      channelPath,
      metadata: { title: "Binding check", description: "Original cartoon", privacyStatus: "private" },
    }).then(() => null, (err: unknown) => err);
    expect(error).toMatchObject({
      code: "POLICY_VIOLATION",
      context: { blocker: "channel_mismatch" },
    });
    const response = toolFailureResponse("toonforge.publish_video", error);
    expect(response.isError).toBe(true);
    const body = response.content[0]?.text ?? "";
    expect(body).toContain("channel_mismatch");
    expect(body).toContain("Refusing to upload");
    assertNoSecrets(body);

    const workflow = toolCallResponse("toonforge.run_daily_workflow", {
      state: "FAILED",
      error: (error as Error).message,
    });
    expect(workflow.isError).toBe(true);
    expect(workflowProcessCode({ state: "FAILED" })).toBe(1);
    expect(publicErrorText((error as Error).message)).toContain("Refusing to upload");
  }, 30_000);

  it("records a scheduler channel mismatch as failed and runs nothing while scheduling is disabled", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-bind-sched-"));
    const config = loadRuntimeConfig({
      TOONFORGE_DATA_DIR: dataDir,
      TOONFORGE_KILL_SWITCH: "false",
      TOONFORGE_MAX_RETRIES: "1",
    });
    const thrown = await runSchedulerTick({
      dataDir,
      now: new Date("2026-10-10T07:00:00.000Z"),
      channels: [channel()],
      config,
      execute: async () => {
        assertChannelBinding({
          channelYoutubeId: TARGET,
          accounts: accounts(OTHER, [OTHER]),
        });
        return { state: "COMPLETE" };
      },
    });
    expect(thrown.ran).toEqual([]);
    expect(thrown.failed).toHaveLength(1);
    const failedJob = loadState(dataDir).jobs.find((job) => job.id === thrown.failed[0]);
    expect(failedJob?.status).toBe("failed");
    expect(failedJob?.lastError).toContain("Refusing to upload");
    assertNoSecrets(failedJob?.lastError ?? "");

    const failedState = mkdtempSync(join(tmpdir(), "tf-bind-sched-state-"));
    const reported = await runSchedulerTick({
      dataDir: failedState,
      now: new Date("2026-10-10T07:00:00.000Z"),
      channels: [channel()],
      config: loadRuntimeConfig({ TOONFORGE_DATA_DIR: failedState, TOONFORGE_KILL_SWITCH: "false", TOONFORGE_MAX_RETRIES: "1" }),
      execute: async () => ({ state: "FAILED", error: "channel_mismatch" }),
    });
    expect(reported.ran).toEqual([]);
    expect(reported.failed).toHaveLength(1);
    expect(loadState(failedState).jobs[0]?.status).toBe("failed");

    const disabledDir = mkdtempSync(join(tmpdir(), "tf-bind-sched-off-"));
    let calls = 0;
    const disabled = await runSchedulerTick({
      dataDir: disabledDir,
      now: new Date("2026-10-10T07:00:00.000Z"),
      channels: [channel({ schedule: { timezone: "UTC", cron: "0 6 * * *", enabled: false } })],
      config: loadRuntimeConfig({ TOONFORGE_DATA_DIR: disabledDir, TOONFORGE_KILL_SWITCH: "false" }),
      execute: async () => {
        calls += 1;
        return { state: "COMPLETE" };
      },
    });
    expect(calls).toBe(0);
    expect(disabled.ran).toEqual([]);
    expect(disabled.failed).toEqual([]);
    expect(disabled.skipped).toEqual([]);
    expect(loadState(disabledDir).jobs).toEqual([]);
  });
});
