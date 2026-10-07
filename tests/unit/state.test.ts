import { describe, expect, it } from "vitest";
import { canTransition, recoverFromFailed, transition, type WorkflowRecord } from "../../src/core/state.js";

function base(): WorkflowRecord {
  return {
    workflowId: "wf_1",
    projectId: "proj_1",
    state: "IDEA",
    lastValidState: "IDEA",
    retryCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

describe("workflow state machine", () => {
  it("allows the happy path", () => {
    expect(canTransition("IDEA", "RESEARCHING")).toBe(true);
    expect(canTransition("QA", "READY_TO_PUBLISH")).toBe(true);
    expect(canTransition("IDEA", "PUBLISHED")).toBe(false);
  });

  it("rejects skipped transitions", () => {
    const record = base();
    expect(() => transition(record, "PRODUCTION")).toThrow(/Illegal transition/);
  });

  it("recovers from FAILED to lastValidState", () => {
    let record = base();
    record = transition(record, "RESEARCHING");
    record = transition(record, "FAILED", "boom");
    const recovered = recoverFromFailed(record);
    expect(recovered.state).toBe("RESEARCHING");
    expect(recovered.retryCount).toBe(1);
  });
});
