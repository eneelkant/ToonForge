import { describe, expect, it } from "vitest";
import { FileCharacterRegistry } from "../../src/characters/registry.js";
import { generateOriginalStory } from "../../src/engines/story/index.js";
import { createStoryboard } from "../../src/engines/storyboard/index.js";
import {
  buildContinuityPlan,
  persistContinuityPlan,
  validateContinuityPlan,
} from "../../src/engines/continuity/index.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("character continuity", () => {
  it("pins character versions per project/shot", async () => {
    const chars = await new FileCharacterRegistry("characters").list();
    const story = generateOriginalStory({ characters: chars.slice(0, 2) });
    const board = createStoryboard(story);
    const plan = await buildContinuityPlan({
      projectId: "p1",
      characters: chars.slice(0, 2),
      storyboard: board,
    });
    expect(plan.pins.length).toBe(2);
    expect(validateContinuityPlan(plan).ok).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "tf-cont-"));
    persistContinuityPlan(dir, plan);
  });
});
