import type { AdapterProbe } from "../types.js";

export interface WorkflowHandle {
  workflowId: string;
  status: "running" | "paused" | "cancelled" | "completed" | "failed" | "queued";
}

export interface AgentHandle {
  agentId: string;
  status: "running" | "idle" | "failed" | "stopped";
}

export interface OrchestratorAdapter extends AdapterProbe {
  name: "ruflo" | "local";
  workflow: {
    start(name: string, input?: Record<string, unknown>): Promise<WorkflowHandle>;
    pause(workflowId: string): Promise<WorkflowHandle>;
    resume(workflowId: string): Promise<WorkflowHandle>;
    cancel(workflowId: string): Promise<WorkflowHandle>;
    status(workflowId: string): Promise<WorkflowHandle>;
  };
  agent: {
    dispatch(role: string, input?: Record<string, unknown>): Promise<AgentHandle>;
    status(agentId: string): Promise<AgentHandle>;
    retry(agentId: string): Promise<AgentHandle>;
    stop(agentId: string): Promise<AgentHandle>;
  };
}
