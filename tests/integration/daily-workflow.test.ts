import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDailyWorkflow } from "../../src/engines/workflow/daily.js";

describe("daily workflow dry-run", () => {
  it("runs end-to-end without publishing", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-daily-"));
    const result = await runDailyWorkflow({ dryRun: true, dataDir });
    expect(result.error).toBeUndefined();
    expect(result.state).toBe("COMPLETE");
    expect(result.dryRun).toBe(true);
    expect(result.qa.verdict).not.toBe("FAIL");
    expect(result.artifacts.videoPath).toBeTruthy();
    expect(result.qa.verdict).toBe("PASS");
  }, 120_000);
});
