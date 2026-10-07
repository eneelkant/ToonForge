import { ToonForgeError } from "./errors.js";
import type { RuntimeConfig } from "./config.js";

export interface SpendLedger {
  dailySpentUsd: number;
  videoSpentUsd: number;
}

export function assertWithinBudget(config: RuntimeConfig, ledger: SpendLedger, nextCostUsd: number): void {
  if (ledger.videoSpentUsd + nextCostUsd > config.perVideoBudgetUsd) {
    throw new ToonForgeError({
      code: "BUDGET_EXCEEDED",
      message: "Per-video budget exceeded",
      component: "core.budget",
      context: { ledger, nextCostUsd, limit: config.perVideoBudgetUsd },
    });
  }
  if (ledger.dailySpentUsd + nextCostUsd > config.dailyBudgetUsd) {
    throw new ToonForgeError({
      code: "BUDGET_EXCEEDED",
      message: "Daily budget exceeded",
      component: "core.budget",
      context: { ledger, nextCostUsd, limit: config.dailyBudgetUsd },
    });
  }
}
