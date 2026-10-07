import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDailyWorkflow } from "../../src/engines/workflow/daily.js";
import { createYoutubeAdapter } from "../../src/adapters/youtube/index.js";
import { loadRuntimeConfig } from "../../src/core/config.js";

describe("e2e cartoon pipeline", () => {
  it("proves transitions, artifacts, qa, idempotent dry publish", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-e2e-"));
    const first = await runDailyWorkflow({ dryRun: true, dataDir });
    expect(first.state).toBe("COMPLETE");
    expect(existsSync(first.artifacts.storyPath!)).toBe(true);
    expect(existsSync(first.artifacts.videoPath!)).toBe(true);
    expect(existsSync(join(dataDir, "projects", first.projectId, "character-continuity.json"))).toBe(true);
    expect(existsSync(join(dataDir, "projects", first.projectId, "qa.json"))).toBe(true);
    const qa = JSON.parse(readFileSync(join(dataDir, "projects", first.projectId, "qa.json"), "utf8"));
    expect(qa.verdict).not.toBe("FAIL");

    const yt = createYoutubeAdapter(loadRuntimeConfig().youtube, { dataDir, dryRunDefault: true });
    const key = `pub:${first.projectId}:video`;
    const again = await yt.publish({
      idempotencyKey: key,
      projectId: first.projectId,
      videoId: "video",
      videoPath: first.artifacts.videoPath!,
      dryRun: true,
      workflowState: "READY_TO_PUBLISH",
      qaStatus: "PASS",
      metadata: {
        title: "t",
        description: "d",
        privacyStatus: "private",
        thumbnailPath: first.artifacts.thumbnailPath,
      },
      provenance: { originalContent: true, thirdPartyFootage: false, licensedAssets: [], notes: [] },
    });
    expect(again.detail).toMatch(/Idempotent|Dry-run/);
  }, 60_000);
});
