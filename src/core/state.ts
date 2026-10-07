import { ToonForgeError } from "./errors.js";

export const WORKFLOW_STATES = [
  "IDEA",
  "RESEARCHING",
  "ANALYZING",
  "STORY_GENERATED",
  "STORYBOARD_READY",
  "PRODUCTION",
  "AUDIO",
  "EDITING",
  "QA",
  "READY_TO_PUBLISH",
  "SCHEDULED",
  "PUBLISHED",
  "ANALYZING_RESULTS",
  "COMPLETE",
  "FAILED",
  "RETRYING",
] as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[number];

/** Happy-path edges. FAILED/RETRYING handled separately. */
const TRANSITIONS: Record<WorkflowState, readonly WorkflowState[]> = {
  IDEA: ["RESEARCHING", "FAILED"],
  RESEARCHING: ["ANALYZING", "FAILED"],
  ANALYZING: ["STORY_GENERATED", "FAILED"],
  STORY_GENERATED: ["STORYBOARD_READY", "FAILED"],
  STORYBOARD_READY: ["PRODUCTION", "FAILED"],
  PRODUCTION: ["AUDIO", "FAILED"],
  AUDIO: ["EDITING", "FAILED"],
  EDITING: ["QA", "FAILED"],
  QA: ["READY_TO_PUBLISH", "FAILED"],
  READY_TO_PUBLISH: ["SCHEDULED", "FAILED"],
  SCHEDULED: ["PUBLISHED", "FAILED"],
  PUBLISHED: ["ANALYZING_RESULTS", "FAILED"],
  ANALYZING_RESULTS: ["COMPLETE", "FAILED"],
  COMPLETE: [],
  FAILED: ["RETRYING"],
  RETRYING: [
    "IDEA",
    "RESEARCHING",
    "ANALYZING",
    "STORY_GENERATED",
    "STORYBOARD_READY",
    "PRODUCTION",
    "AUDIO",
    "EDITING",
    "QA",
    "READY_TO_PUBLISH",
    "SCHEDULED",
    "PUBLISHED",
    "ANALYZING_RESULTS",
  ],
};

export interface WorkflowRecord {
  workflowId: string;
  projectId: string;
  state: WorkflowState;
  lastValidState: WorkflowState;
  retryCount: number;
  error?: string;
  updatedAt: string;
}

export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function transition(
  record: WorkflowRecord,
  to: WorkflowState,
  error?: string,
): WorkflowRecord {
  if (!canTransition(record.state, to)) {
    throw new ToonForgeError({
      code: "STATE_INVALID",
      message: `Illegal transition ${record.state} → ${to}`,
      component: "core.state",
      context: { workflowId: record.workflowId, from: record.state, to },
    });
  }

  const next: WorkflowRecord = {
    ...record,
    state: to,
    updatedAt: new Date().toISOString(),
  };

  if (to === "FAILED") {
    next.error = error ?? "failed";
  } else if (to === "RETRYING") {
    next.retryCount = record.retryCount + 1;
  } else if (to !== "COMPLETE") {
    next.lastValidState = to;
    next.error = undefined;
  }

  return next;
}

export function recoverFromFailed(record: WorkflowRecord): WorkflowRecord {
  if (record.state !== "FAILED") {
    throw new ToonForgeError({
      code: "STATE_INVALID",
      message: "recoverFromFailed requires FAILED state",
      component: "core.state",
    });
  }
  const retrying = transition(record, "RETRYING");
  return transition(retrying, record.lastValidState);
}
