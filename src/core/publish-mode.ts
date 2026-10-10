import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeConfig } from "./config.js";

export const LIVE_OPT_IN_FILE = "live-publish.opt-in.json";

export interface LiveOptIn {
  enabled: true;
  acknowledged: true;
  enabledAt: string;
}

export function liveOptInPath(dataDir: string): string {
  return join(dataDir, LIVE_OPT_IN_FILE);
}

export function readLiveOptIn(dataDir: string): LiveOptIn | null {
  const path = liveOptInPath(dataDir);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LiveOptIn>;
    if (parsed.enabled === true && parsed.acknowledged === true) {
      return {
        enabled: true,
        acknowledged: true,
        enabledAt: typeof parsed.enabledAt === "string" ? parsed.enabledAt : "",
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Live YouTube upload is allowed only when the operator opted in on disk
 * and YOUTUBE_DRY_RUN is explicitly false. An MCP or CLI flag cannot do this alone.
 */
export function livePublishingEnabled(config: RuntimeConfig, dataDir = config.dataDir): boolean {
  return config.youtube.dryRunDefault === false && readLiveOptIn(dataDir) !== null;
}

export interface PublishMode {
  dryRun: boolean;
  requestedLive: boolean;
  liveAllowed: boolean;
  reason: string;
}

export function resolvePublishMode(input: {
  config: RuntimeConfig;
  dataDir?: string;
  requestedLive: boolean;
}): PublishMode {
  const dataDir = input.dataDir ?? input.config.dataDir;
  const liveAllowed = livePublishingEnabled(input.config, dataDir);
  if (!input.requestedLive) {
    return {
      dryRun: true,
      requestedLive: false,
      liveAllowed,
      reason: "Dry-run is the default. Live upload was not requested.",
    };
  }
  if (!liveAllowed) {
    const missing: string[] = [];
    if (input.config.youtube.dryRunDefault) missing.push("YOUTUBE_DRY_RUN is not false");
    if (!readLiveOptIn(dataDir)) missing.push("live-publish.opt-in.json is absent");
    return {
      dryRun: true,
      requestedLive: true,
      liveAllowed: false,
      reason: `Live publishing stayed off (${missing.join("; ")}).`,
    };
  }
  return {
    dryRun: false,
    requestedLive: true,
    liveAllowed: true,
    reason: "Live publishing is explicitly enabled.",
  };
}
