import type { ChannelConfig, RuntimeConfig } from "../../core/config.js";
import { livePublishingEnabled } from "../../core/publish-mode.js";
import { loadAccounts, youtubeStatus } from "../../adapters/youtube/account.js";
import { evaluateChannelBinding } from "../../adapters/youtube/channel-binding.js";
import { assertLoopbackRedirect } from "../../adapters/youtube/connect.js";
import { previewChannel } from "../../scheduler/index.js";

export function publishPreflight(config: RuntimeConfig, channel: ChannelConfig) {
  const auth = youtubeStatus(config, config.dataDir);
  const schedule = previewChannel(channel, new Date(), 3);
  const blockers: string[] = [];
  if (config.killSwitch) blockers.push("kill_switch");
  if (!auth.clientConfigured) blockers.push("oauth_app_missing");
  if (!auth.tokenPresent) blockers.push("authorization_incomplete");
  if (!auth.selectedChannelId) blockers.push("channel_not_selected");
  const binding = evaluateChannelBinding({
    channelYoutubeId: channel.youtube_channel_id,
    envYoutubeId: config.youtube.targetChannelId,
    accounts: loadAccounts(config.dataDir),
  });
  if (!binding.ok) blockers.push(binding.blocker);
  try {
    assertLoopbackRedirect(config.youtube.redirectUri);
  } catch {
    blockers.push("redirect_invalid");
  }
  if (!livePublishingEnabled(config)) blockers.push("live_publishing_disabled");
  if (channel.schedule.enabled === false) blockers.push("schedule_disabled");
  const backend = channel.production_backend ?? "offline_fixture";
  if (backend === "offline_fixture") blockers.push("offline_fixture_is_not_production_media");
  return {
    channelId: channel.channel_id,
    youtubeChannelId: auth.selectedChannelId,
    youtubeChannelTitle: auth.selectedChannelTitle,
    targetChannelId: binding.ok ? binding.targetChannelId : null,
    channelBinding: binding.ok ? "match" : binding.blocker,
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
    redirectUri: config.youtube.redirectUri,
    livePublishingEnabled: livePublishingEnabled(config),
    authClass: auth.authClass,
    blockers,
    liveAllowed: blockers.length === 0,
  };
}
