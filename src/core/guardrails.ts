import { ToonForgeError } from "./errors.js";
import type { RuntimeConfig } from "./config.js";
import type { SpendLedger } from "./budget.js";
import { assertWithinBudget } from "./budget.js";

export interface ResourceLimits {
  monthlyBudgetUsd: number;
  maxStorageMb: number;
  usedStorageMb: number;
  monthlySpentUsd: number;
}

export function assertResourceGuardrails(
  config: RuntimeConfig,
  ledger: SpendLedger,
  limits: ResourceLimits,
  nextCostUsd: number,
): void {
  if (config.killSwitch) {
    throw new ToonForgeError({
      code: "KILL_SWITCH",
      message: "Kill switch enabled",
      component: "core.guardrails",
    });
  }
  assertWithinBudget(config, ledger, nextCostUsd);
  if (limits.monthlySpentUsd + nextCostUsd > limits.monthlyBudgetUsd) {
    throw new ToonForgeError({
      code: "BUDGET_EXCEEDED",
      message: "Monthly budget exceeded",
      component: "core.guardrails",
      context: { limits, nextCostUsd },
    });
  }
  if (limits.usedStorageMb > limits.maxStorageMb) {
    throw new ToonForgeError({
      code: "BUDGET_EXCEEDED",
      message: "Storage limit exceeded",
      component: "core.guardrails",
      context: { limits },
    });
  }
  if (config.maxConcurrentJobs < 1) {
    throw new ToonForgeError({
      code: "CONFIG_INVALID",
      message: "maxConcurrentJobs must be >= 1",
      component: "core.guardrails",
    });
  }
}
