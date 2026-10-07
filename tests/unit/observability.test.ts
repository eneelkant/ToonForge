import { describe, expect, it } from "vitest";
import { createRunContext, buildSystemStatusReport } from "../../src/core/observability.js";

describe("observability", () => {
  it("creates correlation ids and status reports", async () => {
    const ctx = createRunContext({ projectId: "p1" });
    expect(ctx.correlationId).toMatch(/^corr_/);
    const report = await buildSystemStatusReport(async () => ({ ok: true }));
    expect(report.status).toEqual({ ok: true });
  });
});
