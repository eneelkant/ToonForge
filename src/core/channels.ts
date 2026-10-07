import { readdirSync } from "node:fs";
import { join } from "node:path";
import { loadChannelConfig, type ChannelConfig } from "./config.js";

export function listChannelConfigs(dir = "config/channels"): ChannelConfig[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => loadChannelConfig(join(dir, f)));
}

export function getChannelConfig(channelId: string, dir = "config/channels"): ChannelConfig {
  const all = listChannelConfigs(dir);
  const found = all.find((c) => c.channel_id === channelId);
  if (!found) throw new Error(`Unknown channel: ${channelId}`);
  return found;
}
