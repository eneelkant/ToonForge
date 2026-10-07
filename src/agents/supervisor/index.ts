import { evaluatePlan, isDenied, type AgentActionContext } from "../../core/policy.js";
import { assertNotKilled, type RuntimeConfig } from "../../core/config.js";
import { assertWithinBudget, type SpendLedger } from "../../core/budget.js";
import { recoverFromFailed, transition, type WorkflowRecord, type WorkflowState } from "../../core/state.js";
import { ToonForgeError } from "../../core/errors.js";
import { rootLogger } from "../../core/logging.js";

export class SupervisorAgent {
  private readonly log = rootLogger.child("supervisor");

  constructor(private readonly config: RuntimeConfig) {}

  checkAction(ctx: AgentActionContext): void {
    assertNotKilled(this.config);
    const results = evaluatePlan(ctx);
    if (isDenied(results)) {
      throw new ToonForgeError({
        code: "POLICY_VIOLATION",
        message: "Supervisor denied action",
        component: "agents.supervisor",
        context: { results },
      });
    }
  }

  checkBudget(ledger: SpendLedger, nextCostUsd: number): void {
    assertWithinBudget(this.config, ledger, nextCostUsd);
  }

  advance(record: WorkflowRecord, to: WorkflowState, error?: string): WorkflowRecord {
    assertNotKilled(this.config);
    const next = transition(record, to, error);
    this.log.info("workflow.transition", {
      workflowId: record.workflowId,
      projectId: record.projectId,
      from: record.state,
      to,
    });
    return next;
  }

  recover(record: WorkflowRecord): WorkflowRecord {
    if (record.retryCount >= this.config.maxRetries) {
      throw new ToonForgeError({
        code: "RETRY_EXHAUSTED",
        message: "Supervisor refuse recovery: max retries exceeded",
        component: "agents.supervisor",
        context: { retryCount: record.retryCount, maxRetries: this.config.maxRetries },
      });
    }
    return recoverFromFailed(record);
  }
}
