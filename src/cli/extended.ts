import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeConfig } from "../core/config.js";
import { defaultChannelPath } from "../core/paths.js";
import { liveOptInPath } from "../core/publish-mode.js";
import { loadChannelConfig } from "../core/config.js";
import { getAuthUrl } from "../adapters/youtube/oauth.js";
import { connectYoutube, openSystemBrowser } from "../adapters/youtube/connect.js";
import { disconnectChannel, loadAccounts, rememberChannel, youtubeStatus, YOUTUBE_OAUTH_SCOPES } from "../adapters/youtube/account.js";
import { publishPreflight } from "../engines/publish/preflight.js";
import { pauseChannel, pauseGlobal, previewChannel, resumeChannel, resumeGlobal, runSchedulerTick, schedulerStatus } from "../scheduler/index.js";
import { runSetup, type SetupReport } from "../setup/index.js";
import type { ClientName } from "../setup/clients.js";
import { runDailyWorkflow } from "../engines/workflow/daily.js";
import { createOpenMontageAdapter } from "../adapters/openmontage/index.js";
import { createReelMimicAdapter } from "../adapters/reelmimic/index.js";

function tokensOf(sub: string | undefined, rest: string[]): string[] {
  return [sub, ...rest].filter((item): item is string => Boolean(item));
}

function flag(tokens: string[], name: string): boolean {
  return tokens.includes(name);
}

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name);
  if (index < 0) return undefined;
  return tokens[index + 1];
}

export async function dispatchExtended(
  cmd: string,
  sub: string | undefined,
  rest: string[],
  config: RuntimeConfig,
): Promise<boolean> {
  const tokens = tokensOf(sub, rest);
  if (cmd === "setup") {
    const client = option(tokens, "--client") as ClientName | undefined;
    const allowed = ["cursor", "gemini", "claude", "chatgpt"];
    const selected = client && allowed.includes(client) ? (client as ClientName) : undefined;
    const report = await runSetup({
      home: option(tokens, "--home") ?? process.env.HOME ?? process.cwd(),
      platform: process.platform,
      client: selected,
      apply: flag(tokens, "--apply"),
      nonInteractive: flag(tokens, "--non-interactive") || flag(tokens, "--check"),
      dataDir: option(tokens, "--data-dir") ?? config.dataDir,
    });
    console.log(JSON.stringify(publicSetup(report), null, 2));
    if (report.exitCode !== 0) process.exitCode = report.exitCode;
    return true;
  }

  if (cmd === "youtube" && sub === "status") {
    console.log(JSON.stringify(youtubeStatus(config), null, 2));
    return true;
  }
  if (cmd === "youtube" && sub === "channels") {
    const accounts = loadAccounts(config.dataDir);
    console.log(JSON.stringify({
      selectedChannelId: accounts.selectedChannelId ?? null,
      channels: accounts.channels.map((item) => ({ channelId: item.channelId, title: item.title, authorizedAt: item.authorizedAt })),
    }, null, 2));
    return true;
  }
  if (cmd === "youtube" && sub === "disconnect") {
    const channelId = option(tokens, "--channel") ?? loadAccounts(config.dataDir).selectedChannelId;
    if (!channelId) {
      console.error("No YouTube channel is selected");
      process.exitCode = 1;
      return true;
    }
    disconnectChannel(config.dataDir, channelId, config.youtube.tokenPath);
    console.log(JSON.stringify({ disconnected: channelId }));
    return true;
  }
  if (cmd === "youtube" && sub === "test") {
    console.log(JSON.stringify(youtubeStatus(config), null, 2));
    return true;
  }
  if (cmd === "youtube" && sub === "connect") {
    if (!config.youtube.clientId || !config.youtube.clientSecret) {
      console.error("Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET before connecting. Google passwords are never collected.");
      process.exitCode = 2;
      return true;
    }
    const { createOAuth2Client } = await import("../adapters/youtube/oauth.js");
    const { google } = await import("googleapis");
    const connected = await connectYoutube({
      redirectUri: config.youtube.redirectUri,
      selectChannelId: option(tokens, "--channel"),
      authorizationUrl: (state) => getAuthUrl(config.youtube, state),
      openBrowser: async (url) => {
        console.error("Opening the Google authorization page. If it does not open, copy the URL from this error stream.");
        console.error(url);
        await openSystemBrowser(url).catch(() => undefined);
      },
      exchangeCode: async (code) => {
        const auth = createOAuth2Client(config.youtube);
        const { tokens } = await auth.getToken(code);
        return {
          access_token: tokens.access_token ?? undefined,
          refresh_token: tokens.refresh_token ?? undefined,
          scope: tokens.scope ?? YOUTUBE_OAUTH_SCOPES.join(" "),
          token_type: tokens.token_type ?? undefined,
          expiry_date: tokens.expiry_date ?? undefined,
        };
      },
      listChannels: async (token) => {
        const auth = createOAuth2Client(config.youtube);
        auth.setCredentials(token);
        const youtube = google.youtube({ version: "v3", auth });
        const listed = await youtube.channels.list({ part: ["snippet"], mine: true });
        return (listed.data.items ?? []).flatMap((item) => {
          if (!item.id || !item.snippet?.title) return [];
          return [{ channelId: item.id, title: item.snippet.title }];
        });
      },
    });
    const record = rememberChannel({
      dataDir: config.dataDir,
      activeTokenPath: config.youtube.tokenPath,
      channelId: connected.channel.channelId,
      title: connected.channel.title,
      token: connected.token,
      scopes: connected.scopes,
    });
    console.log(JSON.stringify({
      connected: true,
      channelId: record.channelId,
      title: record.title,
      scopes: record.scopes,
    }, null, 2));
    return true;
  }

  if (cmd === "scheduler" && (sub === "status" || sub === "preview")) {
    if (sub === "preview") {
      const channel = loadChannelConfig(option(tokens, "--channel-config") ?? defaultChannelPath());
      console.log(JSON.stringify(previewChannel(channel), null, 2));
      return true;
    }
    console.log(JSON.stringify(schedulerStatus(config.dataDir), null, 2));
    return true;
  }
  if (cmd === "scheduler" && sub === "pause") {
    pauseGlobal(config.dataDir);
    console.log(JSON.stringify({ globalPaused: true }));
    return true;
  }
  if (cmd === "scheduler" && sub === "resume") {
    resumeGlobal(config.dataDir);
    console.log(JSON.stringify({ globalPaused: false }));
    return true;
  }
  if (cmd === "scheduler" && sub === "start") {
    const once = flag(tokens, "--once");
    const channel = loadChannelConfig(option(tokens, "--channel-config") ?? defaultChannelPath());
    const tick = () => runSchedulerTick({
      dataDir: config.dataDir,
      now: new Date(),
      channels: [channel],
      config,
      execute: async (job, selected, ctx) => runDailyWorkflow({
        dryRun: ctx.dryRun,
        projectId: job.projectId,
        workflowId: job.workflowId,
        channelPath: option(tokens, "--channel-config") ?? defaultChannelPath(),
        pipelineMode: selected.production_backend,
      }),
      backendReady: async (selected) => backendReady(config, selected.production_backend),
    });
    if (once) {
      console.log(JSON.stringify(await tick(), null, 2));
      return true;
    }
    const abort = new AbortController();
    process.once("SIGTERM", () => abort.abort());
    process.once("SIGINT", () => abort.abort());
    while (!abort.signal.aborted) {
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
    return true;
  }

  if (cmd === "publish" && sub === "preflight") {
    const channel = loadChannelConfig(option(tokens, "--channel-config") ?? defaultChannelPath());
    console.log(JSON.stringify(publishPreflight(config, channel), null, 2));
    return true;
  }
  if (cmd === "publish" && sub === "enable-live") {
    if (!flag(tokens, "--i-understand")) {
      console.error("Refusing to enable live publishing without --i-understand. This allows unattended uploads when YOUTUBE_DRY_RUN=false.");
      process.exitCode = 2;
      return true;
    }
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(liveOptInPath(config.dataDir), JSON.stringify({
      enabled: true,
      acknowledged: true,
      enabledAt: new Date().toISOString(),
    }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({
      optedIn: true,
      livePublishingEnabled: config.youtube.dryRunDefault === false,
      note: config.youtube.dryRunDefault
        ? "Opt-in saved. Set YOUTUBE_DRY_RUN=false before a live upload can run."
        : "Live publishing is enabled. Default privacy is still taken from DEFAULT_PRIVACY_STATUS.",
    }, null, 2));
    return true;
  }
  if (cmd === "publish" && sub === "disable-live") {
    rmSync(liveOptInPath(config.dataDir), { force: true });
    console.log(JSON.stringify({ livePublishingEnabled: false }));
    return true;
  }

  if (cmd === "pause" && sub === "--channel") {
    const channelId = rest[0];
    if (!channelId) return false;
    pauseChannel(config.dataDir, channelId);
    console.log(JSON.stringify({ paused: true, channelId }));
    return true;
  }
  if (cmd === "resume" && sub === "--channel") {
    const channelId = rest[0];
    if (!channelId) return false;
    resumeChannel(config.dataDir, channelId);
    console.log(JSON.stringify({ paused: false, channelId }));
    return true;
  }
  if (cmd === "update") {
    console.error("toonforge update is not available. This package is not published to a registry. Install a pinned tarball yourself and rerun setup.");
    process.exitCode = 3;
    return true;
  }
  return false;
}

function publicSetup(report: SetupReport) {
  return {
    exitCode: report.exitCode,
    dataDir: report.dataDir,
    configCreated: report.configCreated,
    disk: report.disk ?? null,
    checks: report.checks.map((check) => ({
      id: check.id,
      required: check.required,
      status: check.status,
      detail: check.detail,
      why: check.why,
      install: check.install,
      license: check.license,
    })),
    client: report.client ?? null,
  };
}

async function backendReady(config: RuntimeConfig, backend: "offline_fixture" | "reelmimic" | "openmontage" | undefined) {
  if (!backend || backend === "offline_fixture") return { ok: true, detail: "offline_fixture" };
  if (backend === "reelmimic") {
    const probe = await createReelMimicAdapter(config.reelmimic).probe();
    return { ok: probe.status === "ready", detail: probe.status === "ready" ? "ready" : `reelmimic_${probe.status}` };
  }
  const health = await createOpenMontageAdapter(config.openmontage).health();
  return { ok: health.status === "ready", detail: health.status === "ready" ? "ready" : `openmontage_${health.status}` };
}

export function extendedHelp(): string {
  return `  setup [--check] [--client cursor|gemini|claude|chatgpt] [--apply] [--non-interactive] [--home dir]
  youtube connect [--channel id]
  youtube status
  youtube channels
  youtube disconnect [--channel id]
  youtube test
  scheduler status
  scheduler preview [--channel-config path]
  scheduler start [--once] [--channel-config path]
  scheduler pause
  scheduler resume
  publish preflight [--channel-config path]
  publish enable-live --i-understand
  publish disable-live
  pause --channel <id>
  resume --channel <id>
  update
`;
}
