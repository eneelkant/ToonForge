import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../src/core/config.js";
import { assertResourceGuardrails } from "../../src/core/guardrails.js";

describe("resource guardrails", () => {
  it("blocks monthly overspend", () => {
    const config = loadRuntimeConfig({ TOONFORGE_KILL_SWITCH: "false" });
    expect(() =>
      assertResourceGuardrails(
        config,
        { dailySpentUsd: 0, videoSpentUsd: 0 },
        { monthlyBudgetUsd: 10, monthlySpentUsd: 10, maxStorageMb: 1000, usedStorageMb: 1 },
        1,
      ),
    ).toThrow(/Monthly budget/);
  });
});
