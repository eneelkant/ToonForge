import { describe, expect, it } from "vitest";
import {
  emptyProvenance,
  evaluateProvenanceForPublish,
  stamp,
} from "../../src/core/provenance.js";

describe("provenance gate", () => {
  it("fails closed without characters/assets/transforms", () => {
    const p = emptyProvenance();
    const gate = evaluateProvenanceForPublish(p);
    expect(gate.ok).toBe(false);
    expect(gate.errors.length).toBeGreaterThan(0);
  });

  it("passes complete original provenance with production media", () => {
    const p = emptyProvenance();
    p.creativeTransformations.push("structure-only inspiration");
    p.charactersUsed.push({ id: "max", version: "1.0.0" });
    p.generatedAssets.push({
      type: "video",
      path: "/x/video.mp4",
      kind: "reelmimic",
      provider: "reelmimic",
    });
    p.timestamps.push(stamp("done"));
    expect(evaluateProvenanceForPublish(p).ok).toBe(true);
  });

  it("rejects ffmpeg_dev assets for live publish", () => {
    const p = emptyProvenance();
    p.creativeTransformations.push("structure-only");
    p.charactersUsed.push({ id: "max", version: "1" });
    p.generatedAssets.push({ type: "video", path: "v.mp4", kind: "ffmpeg_dev" });
    expect(evaluateProvenanceForPublish(p).ok).toBe(false);
  });
});
