import { describe, expect, it } from "vitest";
import { evaluatePlan, isDenied } from "../../src/core/policy.js";

describe("agent plan policy", () => {
  it("denies empty goals and criteria", () => {
    const results = evaluatePlan({
      goal: "",
      assumptions: [],
      plannedSteps: [],
      successCriteria: [],
    });
    expect(isDenied(results)).toBe(true);
  });

  it("allows a complete plan", () => {
    const results = evaluatePlan({
      goal: "Generate story for trend X",
      assumptions: ["Canonical characters exist"],
      plannedSteps: ["load characters", "draft premise", "validate originality"],
      successCriteria: ["story.json written", "duplication check pass"],
    });
    expect(isDenied(results)).toBe(false);
  });
});
