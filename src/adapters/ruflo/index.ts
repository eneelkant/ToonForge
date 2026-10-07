import type { RuntimeConfig } from "../../core/config.js";
import type { AdapterAvailability } from "../types.js";
import { createLocalOrchestrator } from "./local.js";
import type { OrchestratorAdapter } from "./types.js";

export type { OrchestratorAdapter, WorkflowHandle, AgentHandle } from "./types.js";
export { createLocalOrchestrator } from "./local.js";

/**
 * Returns a Ruflo-backed orchestrator when enabled AND reachable; otherwise local fallback.
 * Foundation does not shell out to `npx ruflo` yet — probe reports disabled/unavailable.
 */
export function createOrchestrator(config: RuntimeConfig["ruflo"]): OrchestratorAdapter {
  if (!config.enabled) {
    return createLocalOrchestrator();
  }

  const local = createLocalOrchestrator();
  return {
    ...local,
    name: "ruflo",
    async probe(): Promise<AdapterAvailability> {
      return {
        status: "unavailable",
        detail:
          "RUFLO_ENABLED=true but process/MCP bridge is not implemented in foundation; using local APIs only",
      };
    },
  };
}
