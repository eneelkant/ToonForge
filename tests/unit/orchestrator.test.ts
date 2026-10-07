import { describe, expect, it } from "vitest";
import { createLocalOrchestrator } from "../../src/adapters/ruflo/local.js";

describe("local orchestrator", () => {
  it("starts and reports workflow status", async () => {
    const orch = createLocalOrchestrator();
    const started = await orch.workflow.start("daily");
    const status = await orch.workflow.status(started.workflowId);
    expect(status.status).toBe("running");
    const paused = await orch.workflow.pause(started.workflowId);
    expect(paused.status).toBe("paused");
  });
});
