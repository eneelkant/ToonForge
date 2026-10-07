import { describe, expect, it } from "vitest";
import { loadChannelConfig, loadRuntimeConfig, assertNotKilled } from "../../src/core/config.js";
import { publishIdempotencyKey } from "../../src/core/ids.js";

describe("config + idempotency", () => {
  it("loads sample channel config", () => {
    const cfg = loadChannelConfig("config/channels/cartoon-default.yaml");
    expect(cfg.channel_id).toBe("cartoon-default");
    expect(cfg.characters).toContain("max");
  });

  it("honors kill switch", () => {
    const cfg = loadRuntimeConfig({ TOONFORGE_KILL_SWITCH: "true" });
    expect(() => assertNotKilled(cfg)).toThrow(/kill switch/i);
  });

  it("builds stable publish idempotency keys", () => {
    expect(publishIdempotencyKey("p1", "v1")).toBe("pub:p1:v1");
  });
});
