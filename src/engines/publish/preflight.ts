import type { ChannelConfig, RuntimeConfig } from "../../core/config.js";
import { livePublishingEnabled } from "../../core/publish-mode.js";
import { youtubeStatus } from "../../adapters/youtube/account.js";
import { previewChannel } from "../../scheduler/index.js";

export function publishPreflight(config: RuntimeConfig, channel: ChannelConfig) {
  const auth = youtubeStatus(config, config.dataDir);
  const schedule = previewChannel(channel, new Date(), 3);
  const blockers: string[] = [];
  if (config.killSwitch) blockers.push("kill_switch");
  if (!auth.clientConfigured) blockers.push("oauth_app_missing");
  if (!auth.tokenPresent) blockers.push("authorization_incomplete");
  if (!auth.selectedChannelId) blockers.push("channel_not_selected");
  if (!livePublishingEnabled(config)) blockers.push("live_publishing_disabled");
  if (channel.schedule.enabled === false) blockers.push("schedule_disabled");
  const backend = channel.production_backend ?? "offline_fixture";
  if (backend === "offline_fixture") blockers.push("offline_fixture_is_not_production_media");
  return {
    channelId: channel.channel_id,
    youtubeChannelId: auth.selectedChannelId,
    youtubeChannelTitle: auth.selectedChannelTitle,
    timezone: channel.schedule.timezone,
    cron: channel.schedule.cron,
    scheduleEnabled: channel.schedule.enabled,
    nextRuns: schedule.nextRuns,
    privacy: config.youtube.defaultPrivacy,
    publishingMode: channel.publishing_mode,
    backend,
    approvalMode: channel.approval_mode,
    budgets: {
      dailyBudgetUsd: config.dailyBudgetUsd,
      perVideoBudgetUsd: config.perVideoBudgetUsd,
    },
    dryRunDefault: config.youtube.dryRunDefault,
    livePublishingEnabled: livePublishingEnabled(config),
    authClass: auth.authClass,
    blockers,
    liveAllowed: blockers.length === 0,
  };
}
