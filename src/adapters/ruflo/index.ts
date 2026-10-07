import type { RuntimeConfig } from "../../core/config.js";
import { rootLogger } from "../../core/logging.js";
import type { AdapterAvailability } from "../types.js";
import { createLocalOrchestrator } from "./local.js";
import { probeRufloCli } from "./probe.js";
import type { OrchestratorAdapter } from "./types.js";

export type { OrchestratorAdapter, WorkflowHandle, AgentHandle } from "./types.js";
export { createLocalOrchestrator } from "./local.js";
export { probeRufloCli } from "./probe.js";

const log = rootLogger.child("adapters.ruflo");

export interface OrchestratorOptions {
  probeFn?: () => Promise<AdapterAvailability>;
}

/**
 * Returns ToonForge orchestration APIs.
 * When Ruflo is enabled and reachable, probe reports ready but execution still uses the local
 * runner in this phase (stable public API). Future work can bridge MCP dispatch without changing callers.
 */
export function createOrchestrator(
  config: RuntimeConfig["ruflo"],
  options: OrchestratorOptions = {},
): OrchestratorAdapter {
  const local = createLocalOrchestrator();

  if (!config.enabled) {
    return local;
  }

  const probeFn = options.probeFn ?? (() => probeRufloCli(config.probeTimeoutMs));

  return {
    ...local,
    name: "ruflo",
    async probe(): Promise<AdapterAvailability> {
      const availability = await probeFn();
      if (availability.status !== "ready") {
        log.warn("ruflo.unavailable_falling_back_local", { detail: availability.detail });
        return {
          status: "unavailable",
          detail: `${availability.detail}; local orchestrator remains active for workflow/agent APIs`,
        };
      }
      return {
        status: "ready",
        detail: `ruflo reachable (${availability.detail}); execution delegated through ToonForge local runner bridge`,
      };
    },
  };
}
