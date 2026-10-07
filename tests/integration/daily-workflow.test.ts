import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDailyWorkflow } from "../../src/engines/workflow/daily.js";

describe("daily workflow dry-run", () => {
  it("runs end-to-end without publishing using configured trend sources", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-daily-"));
    const result = await runDailyWorkflow({
      dryRun: true,
      dataDir,
      pipelineMode: "offline_fixture",
    });
    expect(result.error).toBeUndefined();
    expect(result.state).toBe("COMPLETE");
    expect(result.dryRun).toBe(true);
    expect(result.pipelineMode).toBe("offline_fixture");
    expect(result.qa.verdict).toBe("PASS");
    expect(result.artifacts.videoPath).toBeTruthy();

    const projectDir = join(dataDir, "projects", result.projectId);
    expect(existsSync(join(projectDir, "synthetic-reference.txt"))).toBe(false);
    const trends = JSON.parse(readFileSync(join(projectDir, "trends.json"), "utf8"));
    expect(trends.providers).toContain("manual");
    const provenance = JSON.parse(readFileSync(join(projectDir, "provenance.json"), "utf8"));
    expect(provenance.referenceSources[0].role).toBe("reference-format-analysis");
    expect(provenance.referenceSources[0].analysisOnly).toBe(true);
    expect(provenance.pipelineMode).toBe("offline_fixture");
    const resolution = JSON.parse(readFileSync(join(projectDir, "reference-resolution.json"), "utf8"));
    expect(resolution.designation).toBe("offline_fixture");
  }, 120_000);

  it("fails reelmimic mode without a real video reference", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-daily-rm-"));
    const result = await runDailyWorkflow({
      dryRun: true,
      dataDir,
      pipelineMode: "reelmimic",
    });
    expect(result.state).toBe("FAILED");
    expect(result.error).toMatch(/reference|ReelMimic|video/i);
  }, 60_000);
});
