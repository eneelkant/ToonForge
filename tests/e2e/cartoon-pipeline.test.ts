import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDailyWorkflow } from "../../src/engines/workflow/daily.js";
import { createYoutubeAdapter } from "../../src/adapters/youtube/index.js";
import { loadRuntimeConfig } from "../../src/core/config.js";
import { validateAudio, validateImage, validateVideo } from "../../src/core/media.js";

describe("e2e cartoon pipeline", () => {
  it("proves transitions, valid media, qa, idempotent dry publish", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-e2e-"));
    const first = await runDailyWorkflow({ dryRun: true, dataDir, pipelineMode: "offline_fixture" });
    expect(first.state).toBe("COMPLETE");
    expect(first.pipelineMode).toBe("offline_fixture");
    expect(first.error).toBeUndefined();
    expect(existsSync(join(dataDir, "projects", first.projectId, "synthetic-reference.txt"))).toBe(false);
    expect(existsSync(first.artifacts.storyPath!)).toBe(true);
    expect(existsSync(first.artifacts.videoPath!)).toBe(true);
    expect(existsSync(join(dataDir, "projects", first.projectId, "character-continuity.json"))).toBe(true);
    expect(existsSync(join(dataDir, "projects", first.projectId, "provenance.json"))).toBe(true);
    expect(existsSync(join(dataDir, "projects", first.projectId, "qa.json"))).toBe(true);
    expect(existsSync(join(dataDir, "projects", first.projectId, "workflow.json"))).toBe(true);

    const video = await validateVideo(first.artifacts.videoPath!, { requireAudio: true, minDurationSec: 0.5 });
    expect(video.ok).toBe(true);
    expect(video.hasVideo).toBe(true);
    expect(video.hasAudio).toBe(true);

    const audio = await validateAudio(first.artifacts.audioPath!);
    expect(audio.ok).toBe(true);

    const thumb = await validateImage(first.artifacts.thumbnailPath!, {
      minWidth: 640,
      minHeight: 360,
      expectedAspect: 16 / 9,
    });
    expect(thumb.ok).toBe(true);

    const qa = JSON.parse(readFileSync(join(dataDir, "projects", first.projectId, "qa.json"), "utf8"));
    expect(qa.verdict).toBe("PASS");

    const provenance = JSON.parse(
      readFileSync(join(dataDir, "projects", first.projectId, "provenance.json"), "utf8"),
    );
    expect(provenance.originalContent).toBe(true);
    expect(provenance.charactersUsed.length).toBeGreaterThan(0);
    expect(provenance.generatedAssets.length).toBeGreaterThan(0);

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
  }, 120_000);
});
