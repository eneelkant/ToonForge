import { describe, expect, it } from "vitest";
import { handleTool, listPrompts, listResources } from "../../src/mcp/handlers.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";

describe("MCP handlers", () => {
  it("exposes the core tool catalog", () => {
    expect(MCP_TOOL_NAMES).toContain("toonforge.run_daily_workflow");
    expect(listResources().length).toBeGreaterThan(0);
    expect(listPrompts().length).toBeGreaterThan(0);
  });

  it("lists characters and discovers trends via channel trend_sources", async () => {
    const chars = await handleTool("toonforge.list_characters", {});
    expect(Array.isArray(chars)).toBe(true);
    const result = (await handleTool("toonforge.discover_trends", { limit: 2 })) as {
      providers: string[];
      trends: unknown[];
      trend_sources: string[];
    };
    expect(result.trend_sources).toContain("manual");
    expect(result.providers).toContain("manual");
    expect(Array.isArray(result.trends)).toBe(true);
    expect(result.trends.length).toBeGreaterThan(0);
  });

  it("pause blocks non-status tools", async () => {
    await handleTool("toonforge.pause", {});
    const blocked = await handleTool("toonforge.discover_trends", {});
    expect(blocked).toMatchObject({ code: "PAUSED" });
    await handleTool("toonforge.resume", {});
    const ok = (await handleTool("toonforge.discover_trends", { limit: 1 })) as {
      trends: unknown[];
    };
    expect(Array.isArray(ok.trends)).toBe(true);
  });
});
