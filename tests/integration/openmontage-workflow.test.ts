import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultCharacterRegistry } from "../../src/characters/registry.js";
import { generateDevVideo } from "../../src/core/media.js";
import type { OpenMontageAdapter } from "../../src/adapters/openmontage/types.js";
import { runDailyWorkflow } from "../../src/engines/workflow/daily.js";

function readyAdapter(): OpenMontageAdapter {
  return {
    name: "openmontage",
    async probe() {
      return { status: "ready" };
    },
    async health() {
      return { status: "ready", detail: "test double" };
    },
    async renderCharacterAnimation(input) {
      const videoPath = join(input.workspace, "video.mp4");
      await generateDevVideo({ outPath: videoPath, durationSec: 2, withAudio: false, label: "om" });
      return {
        videoPath,
        artifactPaths: [videoPath],
        versions: { character_rig_renderer: "0.1.0" },
        characterIds: input.characters.map((c) => c.character_id),
        displayNames: input.characters.map((c) => c.display_name),
        durationMs: 1,
        retryCount: 0,
        estimatedCostUsd: 0,
        actualCostUsd: 0,
        approval: { agentPipeline: "not_invoked", detail: "test double; approvals not simulated" },
      };
    },
  };
}

describe("daily workflow OpenMontage selection", () => {
  it("records the OpenMontage backend and keeps reference analysis footage-free", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-om-daily-"));
    const characters = await defaultCharacterRegistry().list();
    const result = await runDailyWorkflow({
      dryRun: true,
      dataDir,
      pipelineMode: "openmontage",
      openmontage: readyAdapter(),
    });
    // Video is production media. Narration, music, and the thumbnail are still
    // ffmpeg_dev, and only offline_fixture may accept those. QA must fail closed
    // before any publish manifest is written.
    expect(result.error).toBe("QA FAIL");
    expect(result.state).toBe("FAILED");
    expect(result.pipelineMode).toBe("openmontage");
    expect(result.qa.verdict).toBe("FAIL");
    expect(result.qa.mediaKinds?.video).toBe("openmontage");
    expect(existsSync(join(dataDir, "publish-manifests"))).toBe(false);
    const projectDir = join(dataDir, "projects", result.projectId);
    const provenance = JSON.parse(readFileSync(join(projectDir, "provenance.json"), "utf8")) as {
      pipelineMode: string;
      production: { backend: string; thirdPartyFootageReused: boolean; approval: string };
      referenceSources: Array<{ footageReused: boolean; analysisOnly: boolean }>;
      charactersUsed: Array<{ id: string }>;
      generatedAssets: Array<{ type: string; kind: string }>;
    };
    expect(provenance.pipelineMode).toBe("openmontage");
    expect(provenance.production.backend).toBe("openmontage");
    expect(provenance.production.thirdPartyFootageReused).toBe(false);
    expect(provenance.production.approval).toBe("not_invoked");
    expect(provenance.referenceSources[0]?.footageReused).toBe(false);
    expect(provenance.referenceSources[0]?.analysisOnly).toBe(true);
    expect(provenance.charactersUsed.map((c) => c.id).sort()).toEqual(characters.map((c) => c.character_id).sort());
    expect(provenance.generatedAssets.find((a) => a.type === "video")?.kind).toBe("openmontage");
    const production = JSON.parse(readFileSync(join(projectDir, "out", "production.json"), "utf8")) as {
      backend: string;
    };
    expect(production.backend).toBe("openmontage");
  }, 120_000);

  it("fails closed when the selected OpenMontage adapter fails", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-om-fail-"));
    const result = await runDailyWorkflow({
      dryRun: true,
      dataDir,
      pipelineMode: "openmontage",
      openmontage: {
        name: "openmontage",
        async probe() {
          return { status: "unavailable", detail: "down" };
        },
        async health() {
          return { status: "not_installed", detail: "missing checkout" };
        },
        async renderCharacterAnimation() {
          throw new Error("should not render");
        },
      },
    });
    expect(result.state).toBe("FAILED");
    expect(result.pipelineMode).toBe("openmontage");
    expect(result.error).toMatch(/not_installed|OpenMontage/);
    expect(result.error).not.toMatch(/ffmpeg_dev/);
  }, 60_000);
});
