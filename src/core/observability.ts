import { rootLogger, type LogFields } from "./logging.js";
import { newId } from "./ids.js";

export interface RunContext {
  correlationId: string;
  workflowId?: string;
  projectId?: string;
  agentId?: string;
}

export function createRunContext(partial: Partial<RunContext> = {}): RunContext {
  return {
    correlationId: partial.correlationId ?? newId("corr"),
    workflowId: partial.workflowId,
    projectId: partial.projectId,
    agentId: partial.agentId,
  };
}

export function logEvent(ctx: RunContext, message: string, fields?: LogFields): void {
  rootLogger.info(message, {
    correlationId: ctx.correlationId,
    workflowId: ctx.workflowId,
    projectId: ctx.projectId,
    agentId: ctx.agentId,
    ...fields,
  });
}

export async function buildSystemStatusReport(getStatus: () => Promise<unknown>) {
  const started = Date.now();
  const status = await getStatus();
  return {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    status,
  };
}
