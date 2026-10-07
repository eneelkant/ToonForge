import type { RuntimeConfig } from "../../core/config.js";
import { createOmniCharAdapter } from "../../adapters/omnichar/index.js";
import { createReelMimicAdapter } from "../../adapters/reelmimic/index.js";
import { createYoutubeAdapter } from "../../adapters/youtube/index.js";
import { createOrchestrator } from "../../adapters/ruflo/index.js";

/** High-level system status for MCP `toonforge.get_system_status` (foundation). */
export async function getSystemStatus(config: RuntimeConfig) {
  const omnichar = createOmniCharAdapter(config.omnichar);
  const reelmimic = createReelMimicAdapter(config.reelmimic);
  const youtube = createYoutubeAdapter(config.youtube);
  const orchestrator = createOrchestrator(config.ruflo);

  const omnicharProbe = await omnichar.probe();
  const omnicharHealth = await omnichar.health();

  return {
    killSwitch: config.killSwitch,
    adapters: {
      omnichar: omnicharProbe,
      omnicharHealth,
      reelmimic: await reelmimic.probe(),
      youtube: await youtube.probe(),
      orchestrator: await orchestrator.probe(),
    },
    config: {
      omnichar: {
        enabled: config.omnichar.enabled,
        baseUrl: config.omnichar.baseUrl,
        timeoutMs: config.omnichar.timeoutMs,
        maxRetries: config.omnichar.maxRetries,
      },
    },
    budgets: {
      dailyBudgetUsd: config.dailyBudgetUsd,
      perVideoBudgetUsd: config.perVideoBudgetUsd,
      maxConcurrentJobs: config.maxConcurrentJobs,
      maxRetries: config.maxRetries,
    },
  };
}
