import { describe, expect, it } from "vitest";
import { FileCharacterRegistry } from "../../src/characters/registry.js";

describe("character registry", () => {
  it("lists seeded canonical characters", async () => {
    const registry = new FileCharacterRegistry("characters");
    const list = await registry.list();
    const ids = list.map((c) => c.character_id).sort();
    expect(ids).toEqual(["bolt", "max", "milo"]);
  });

  it("resolves preferred characters for a story", async () => {
    const registry = new FileCharacterRegistry("characters");
    const resolved = await registry.resolve_for_story({
      roles: ["lead", "sidekick"],
      preferredIds: ["max", "bolt"],
    });
    expect(resolved.map((c) => c.character_id)).toEqual(["max", "bolt"]);
  });
});
