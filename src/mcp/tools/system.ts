import type { RuntimeConfig } from "../../core/config.js";
import { createOmniCharAdapter } from "../../adapters/omnichar/index.js";
import { createReelMimicAdapter } from "../../adapters/reelmimic/index.js";
import { createYoutubeAdapter } from "../../adapters/youtube/index.js";
import { createOrchestrator } from "../../adapters/ruflo/index.js";
import { createOpenMontageAdapter } from "../../adapters/openmontage/index.js";

/** High-level system status for MCP `toonforge.get_system_status` (foundation). */
export async function getSystemStatus(config: RuntimeConfig) {
  const omnichar = createOmniCharAdapter(config.omnichar);
  const reelmimic = createReelMimicAdapter(config.reelmimic);
  const youtube = createYoutubeAdapter(config.youtube);
  const orchestrator = createOrchestrator(config.ruflo);
  const openmontage = createOpenMontageAdapter(config.openmontage);

  const omnicharProbe = await omnichar.probe();
  const omnicharHealth = await omnichar.health();

  return {
    killSwitch: config.killSwitch,
    adapters: {
      omnichar: omnicharProbe,
      omnicharHealth,
      reelmimic: await reelmimic.probe(),
      reelmimicHealth: await reelmimic.health(),
      youtube: await youtube.probe(),
      orchestrator: await orchestrator.probe(),
      openmontage: await openmontage.probe(),
      openmontageHealth: await openmontage.health(),
    },
    config: {
      omnichar: {
        enabled: config.omnichar.enabled,
        baseUrl: config.omnichar.baseUrl,
        timeoutMs: config.omnichar.timeoutMs,
        maxRetries: config.omnichar.maxRetries,
      },
      reelmimic: {
        enabled: config.reelmimic.enabled,
        baseUrl: config.reelmimic.baseUrl,
        root: config.reelmimic.root ?? null,
        timeoutMs: config.reelmimic.timeoutMs,
        maxRetries: config.reelmimic.maxRetries,
      },
      openmontage: {
        enabled: config.openmontage.enabled,
        root: config.openmontage.root ?? null,
        python: config.openmontage.python,
        timeoutMs: config.openmontage.timeoutMs,
        maxRetries: config.openmontage.maxRetries,
      },
      youtubeTrends: {
        enabled: config.youtubeTrends.enabled,
        regionCode: config.youtubeTrends.regionCode,
        categoryId: config.youtubeTrends.categoryId ?? null,
        maxResults: config.youtubeTrends.maxResults,
        apiKeyConfigured: Boolean(config.youtubeTrends.apiKey),
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
