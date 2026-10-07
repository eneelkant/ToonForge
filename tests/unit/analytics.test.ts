import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestAnalytics, loadAnalytics, recommendFromAnalytics } from "../../src/engines/analytics/index.js";

describe("analytics learning", () => {
  it("stores snapshots and yields pending recommendations", () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-an-"));
    ingestAnalytics(dir, {
      videoId: "v1",
      capturedAt: new Date().toISOString(),
      ctr: 0.08,
      hook: "We can fix this",
      simulated: false,
    });
    const snaps = loadAnalytics(dir);
    expect(snaps.length).toBe(1);
    const recs = recommendFromAnalytics(snaps);
    expect(recs[0]?.status).toBe("pending");
  });
});
