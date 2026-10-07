import type { AdapterProbe } from "../types.js";

export interface WorkflowHandle {
  workflowId: string;
  status: "running" | "paused" | "cancelled" | "completed" | "failed" | "queued";
  input?: Record<string, unknown>;
  startedAt?: string;
}

export interface AgentHandle {
  agentId: string;
  status: "running" | "idle" | "failed" | "stopped";
  role?: string;
  input?: Record<string, unknown>;
  updatedAt?: string;
}

export interface OrchestratorAdapter extends AdapterProbe {
  name: "ruflo" | "local";
  registerAgent?(role: string): Promise<AgentHandle>;
  listAgents?(): AgentHandle[];
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
