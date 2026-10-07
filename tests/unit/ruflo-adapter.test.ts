import { describe, expect, it } from "vitest";
import { createLocalOrchestrator, createOrchestrator } from "../../src/adapters/ruflo/index.js";

describe("Ruflo / local orchestrator", () => {
  it("local registers and dispatches agents", async () => {
    const orch = createLocalOrchestrator();
    const registered = await orch.registerAgent?.("story");
    expect(registered?.status).toBe("idle");
    const started = await orch.workflow.start("daily", { channel: "cartoon-default" });
    expect(started.status).toBe("running");
    const agent = await orch.agent.dispatch("qa", { projectId: "p1" });
    expect(agent.status).toBe("running");
    await orch.agent.stop(agent.agentId);
    expect((await orch.agent.status(agent.agentId)).status).toBe("stopped");
  });

  it("falls back when Ruflo probe unavailable", async () => {
    const orch = createOrchestrator(
      { enabled: true, probeTimeoutMs: 100 },
      {
        probeFn: async () => ({ status: "unavailable", detail: "offline" }),
      },
    );
    const probe = await orch.probe();
    expect(probe.status).toBe("unavailable");
    const wf = await orch.workflow.start("still-works");
    expect(wf.status).toBe("running");
  });

  it("reports ready when Ruflo probe succeeds but keeps local execution", async () => {
    const orch = createOrchestrator(
      { enabled: true, probeTimeoutMs: 100 },
      { probeFn: async () => ({ status: "ready", detail: "3.54.0" }) },
    );
    expect((await orch.probe()).status).toBe("ready");
    expect(orch.name).toBe("ruflo");
  });
});
