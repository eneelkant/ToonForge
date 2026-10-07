import { describe, expect, it } from "vitest";
import { listChannelConfigs, getChannelConfig } from "../../src/core/channels.js";

describe("multi-channel config", () => {
  it("loads multiple channel yaml files", () => {
    const all = listChannelConfigs();
    expect(all.map((c) => c.channel_id).sort()).toEqual(["cartoon-default", "cartoon-edu"]);
    expect(getChannelConfig("cartoon-edu").style).toBe("crayon-storybook");
  });
});
