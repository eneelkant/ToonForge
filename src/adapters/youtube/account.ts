import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeConfig } from "../../core/config.js";
import { livePublishingEnabled } from "../../core/publish-mode.js";
import { loadTokenFile, saveTokenFile, type TokenJson } from "./oauth.js";

export interface YoutubeChannelRecord {
  channelId: string;
  title: string;
  tokenFile: string;
  authorizedAt: string;
  scopes: string[];
}

export interface YoutubeAccountFile {
  selectedChannelId?: string;
  channels: YoutubeChannelRecord[];
}

export function accountPath(dataDir: string): string {
  return join(dataDir, "youtube", "accounts.json");
}

export function loadAccounts(dataDir: string): YoutubeAccountFile {
  const path = accountPath(dataDir);
  if (!existsSync(path)) return { channels: [] };
  const parsed = JSON.parse(readFileSync(path, "utf8")) as YoutubeAccountFile;
  return { selectedChannelId: parsed.selectedChannelId, channels: parsed.channels ?? [] };
}

export function saveAccounts(dataDir: string, accounts: YoutubeAccountFile): void {
  const path = accountPath(dataDir);
  mkdirSync(join(dataDir, "youtube"), { recursive: true });
  writeFileSync(path, JSON.stringify(accounts, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function channelTokenPath(dataDir: string, channelId: string): string {
  return join(dataDir, "youtube", "tokens", `${channelId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
}

export function rememberChannel(input: {
  dataDir: string;
  activeTokenPath: string;
  channelId: string;
  title: string;
  token: TokenJson;
  scopes: string[];
}): YoutubeChannelRecord {
  const tokenFile = channelTokenPath(input.dataDir, input.channelId);
  saveTokenFile(tokenFile, input.token);
  chmodSync(tokenFile, 0o600);
  saveTokenFile(input.activeTokenPath, input.token);
  chmodSync(input.activeTokenPath, 0o600);
  const accounts = loadAccounts(input.dataDir);
  const record: YoutubeChannelRecord = {
    channelId: input.channelId,
    title: input.title,
    tokenFile,
    authorizedAt: new Date().toISOString(),
    scopes: input.scopes,
  };
  accounts.channels = accounts.channels.filter((item) => item.channelId !== input.channelId);
  accounts.channels.push(record);
  accounts.selectedChannelId = input.channelId;
  saveAccounts(input.dataDir, accounts);
  return record;
}

export function disconnectChannel(dataDir: string, channelId: string, activeTokenPath: string): void {
  const accounts = loadAccounts(dataDir);
  const found = accounts.channels.find((item) => item.channelId === channelId);
  accounts.channels = accounts.channels.filter((item) => item.channelId !== channelId);
  if (accounts.selectedChannelId === channelId) accounts.selectedChannelId = accounts.channels[0]?.channelId;
  saveAccounts(dataDir, accounts);
  if (found && existsSync(found.tokenFile)) rmSync(found.tokenFile);
  if (accounts.selectedChannelId) {
    const next = accounts.channels.find((item) => item.channelId === accounts.selectedChannelId);
    if (next && existsSync(next.tokenFile)) {
      const token = loadTokenFile(next.tokenFile);
      if (token) saveTokenFile(activeTokenPath, token);
    }
  } else if (existsSync(activeTokenPath)) {
    rmSync(activeTokenPath);
  }
}

export type YoutubeAuthClass =
  | "ready"
  | "oauth_app_missing"
  | "authorization_incomplete"
  | "token_expired"
  | "insufficient_scope"
  | "channel_unavailable"
  | "quota_exceeded"
  | "verification_required";

export function classifyYoutubeFailure(message: string): { errorClass: YoutubeAuthClass; retryable: boolean; remediation: string } {
  const text = message.toLowerCase();
  if (text.includes("quota") || text.includes("ratelimit") || text.includes("403") && text.includes("daily")) {
    return { errorClass: "quota_exceeded", retryable: true, remediation: "Wait for the YouTube Data API quota window or request more quota in Google Cloud." };
  }
  if (text.includes("access_not_configured") || text.includes("verification") || text.includes("unverified")) {
    return {
      errorClass: "verification_required",
      remediation: "Google controls OAuth verification and testing-mode user caps. ToonForge cannot bypass them.",
      retryable: false,
    };
  }
  if (text.includes("insufficient") || text.includes("scope")) {
    return { errorClass: "insufficient_scope", retryable: false, remediation: "Reconnect and grant youtube.readonly and youtube.upload." };
  }
  if (text.includes("invalid_grant") || text.includes("expired") || text.includes("revoked")) {
    return { errorClass: "token_expired", retryable: false, remediation: "Run toonforge youtube connect again." };
  }
  if (text.includes("channel") && text.includes("not")) {
    return { errorClass: "channel_unavailable", retryable: false, remediation: "The authorized Google account has no matching YouTube channel." };
  }
  return { errorClass: "authorization_incomplete", retryable: false, remediation: "Run toonforge youtube connect." };
}

const UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
const READ_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

export function youtubeStatus(config: RuntimeConfig, dataDir = config.dataDir) {
  const accounts = loadAccounts(dataDir);
  const selected = accounts.channels.find((item) => item.channelId === accounts.selectedChannelId) ?? null;
  const token = loadTokenFile(config.youtube.tokenPath);
  const scopes = token?.scope?.split(/\s+/).filter(Boolean) ?? selected?.scopes ?? [];
  let authClass: YoutubeAuthClass = "ready";
  if (!config.youtube.clientId || !config.youtube.clientSecret) authClass = "oauth_app_missing";
  else if (!token?.refresh_token && !token?.access_token) authClass = "authorization_incomplete";
  else if (token.expiry_date && token.expiry_date < Date.now() && !token.refresh_token) authClass = "token_expired";
  else if (scopes.length && (!scopes.includes(UPLOAD_SCOPE) || !scopes.includes(READ_SCOPE))) authClass = "insufficient_scope";
  else if (!selected) authClass = "channel_unavailable";
  return {
    authClass,
    clientConfigured: Boolean(config.youtube.clientId && config.youtube.clientSecret),
    tokenPresent: Boolean(token?.refresh_token || token?.access_token),
    refreshTokenPresent: Boolean(token?.refresh_token),
    selectedChannelId: selected?.channelId ?? null,
    selectedChannelTitle: selected?.title ?? null,
    channelCount: accounts.channels.length,
    scopes,
    dryRunDefault: config.youtube.dryRunDefault,
    livePublishingEnabled: livePublishingEnabled(config, dataDir),
    defaultPrivacy: config.youtube.defaultPrivacy,
  };
}

export const YOUTUBE_OAUTH_SCOPES = [READ_SCOPE, UPLOAD_SCOPE];
