import { describe, expect, it } from "vitest";
import { handleTool, listPrompts, listResources } from "../../src/mcp/handlers.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";

describe("MCP handlers", () => {
  it("exposes the core tool catalog", () => {
    expect(MCP_TOOL_NAMES).toContain("toonforge.run_daily_workflow");
    expect(listResources().length).toBeGreaterThan(0);
    expect(listPrompts().length).toBeGreaterThan(0);
  });

  it("lists characters and discovers trends", async () => {
    const chars = await handleTool("toonforge.list_characters", {});
    expect(Array.isArray(chars)).toBe(true);
    const trends = await handleTool("toonforge.discover_trends", { limit: 2 });
    expect(Array.isArray(trends)).toBe(true);
  });

  it("pause blocks non-status tools", async () => {
    await handleTool("toonforge.pause", {});
    const blocked = await handleTool("toonforge.discover_trends", {});
    expect(blocked).toMatchObject({ code: "PAUSED" });
    await handleTool("toonforge.resume", {});
    const ok = await handleTool("toonforge.discover_trends", { limit: 1 });
    expect(Array.isArray(ok)).toBe(true);
  });
});
