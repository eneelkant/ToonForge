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

  return {
    killSwitch: config.killSwitch,
    adapters: {
      omnichar: await omnichar.probe(),
      reelmimic: await reelmimic.probe(),
      youtube: await youtube.probe(),
      orchestrator: await orchestrator.probe(),
    },
    budgets: {
      dailyBudgetUsd: config.dailyBudgetUsd,
      perVideoBudgetUsd: config.perVideoBudgetUsd,
      maxConcurrentJobs: config.maxConcurrentJobs,
      maxRetries: config.maxRetries,
    },
  };
}
