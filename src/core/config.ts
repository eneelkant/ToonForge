import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ToonForgeError } from "./errors.js";

export const ChannelConfigSchema = z.object({
  channel_id: z.string().min(1),
  channel_name: z.string().min(1),
  niche: z.string().min(1),
  format: z.enum(["shorts", "long_form", "both"]).default("shorts"),
  schedule: z.object({
    timezone: z.string().default("UTC"),
    cron: z.string().default("0 6 * * *"),
    enabled: z.boolean().default(true),
  }),
  characters: z.array(z.string()).default([]),
  style: z.string().default("cartoon"),
  duration_seconds: z.number().int().positive().default(45),
  max_daily_videos: z.number().int().positive().default(1),
  approval_mode: z.enum(["manual", "auto"]).default("manual"),
  publishing_mode: z.enum(["schedule", "private", "public"]).default("schedule"),
  trend_sources: z.array(z.string()).default(["manual"]),
  quality_threshold: z.number().min(0).max(1).default(0.7),
  risk_threshold: z.number().min(0).max(1).default(0.3),
});

export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

export interface RuntimeConfig {
  dataDir: string;
  killSwitch: boolean;
  dailyBudgetUsd: number;
  perVideoBudgetUsd: number;
  maxConcurrentJobs: number;
  maxRetries: number;
  omnichar: {
    enabled: boolean;
    baseUrl: string;
    timeoutMs: number;
    maxRetries: number;
  };
  reelmimic: {
    enabled: boolean;
    baseUrl: string;
    root?: string;
    timeoutMs: number;
    maxRetries: number;
  };
  ruflo: { enabled: boolean };
  youtube: {
    clientId?: string;
    clientSecret?: string;
    redirectUri: string;
    tokenPath: string;
    defaultPrivacy: "private" | "unlisted" | "public";
  };
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    dataDir: env.TOONFORGE_DATA_DIR || "./data",
    killSwitch: env.TOONFORGE_KILL_SWITCH === "true",
    dailyBudgetUsd: Number(env.TOONFORGE_DAILY_BUDGET_USD || 25),
    perVideoBudgetUsd: Number(env.TOONFORGE_PER_VIDEO_BUDGET_USD || 5),
    maxConcurrentJobs: Number(env.TOONFORGE_MAX_CONCURRENT_JOBS || 1),
    maxRetries: Number(env.TOONFORGE_MAX_RETRIES || 3),
    omnichar: {
      enabled: env.OMNICHAR_ENABLED === "true",
      baseUrl: env.OMNICHAR_BASE_URL || "http://127.0.0.1:8848",
      timeoutMs: Number(env.OMNICHAR_TIMEOUT_MS || 10_000),
      maxRetries: Number(env.OMNICHAR_MAX_RETRIES || 3),
    },
    reelmimic: {
      enabled: env.REELMIMIC_ENABLED === "true",
      baseUrl: env.REELMIMIC_BASE_URL || "http://127.0.0.1:4318",
      root: env.REELMIMIC_ROOT,
      timeoutMs: Number(env.REELMIMIC_TIMEOUT_MS || 30_000),
      maxRetries: Number(env.REELMIMIC_MAX_RETRIES || 3),
    },
    ruflo: {
      enabled: env.RUFLO_ENABLED === "true",
    },
    youtube: {
      clientId: env.YOUTUBE_CLIENT_ID,
      clientSecret: env.YOUTUBE_CLIENT_SECRET,
      redirectUri: env.YOUTUBE_REDIRECT_URI || "http://127.0.0.1",
      tokenPath: env.YOUTUBE_TOKEN_PATH || "./data/youtube-token.json",
      defaultPrivacy: (env.DEFAULT_PRIVACY_STATUS as RuntimeConfig["youtube"]["defaultPrivacy"]) || "private",
    },
  };
}

export function loadChannelConfig(path: string): ChannelConfig {
  const abs = resolve(path);
  if (!existsSync(abs)) {
    throw new ToonForgeError({
      code: "CONFIG_INVALID",
      message: `Channel config not found: ${abs}`,
      component: "core.config",
    });
  }
  const raw = parseYaml(readFileSync(abs, "utf8"));
  const parsed = ChannelConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ToonForgeError({
      code: "CONFIG_INVALID",
      message: "Channel config failed validation",
      component: "core.config",
      context: { issues: parsed.error.issues },
    });
  }
  return parsed.data;
}

export function assertNotKilled(config: RuntimeConfig): void {
  if (config.killSwitch) {
    throw new ToonForgeError({
      code: "KILL_SWITCH",
      message: "Global kill switch is enabled (TOONFORGE_KILL_SWITCH=true)",
      component: "core.config",
      retryable: false,
    });
  }
}
