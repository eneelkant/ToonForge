import { newId } from "../../core/ids.js";
import { ToonForgeError } from "../../core/errors.js";
import type { AdapterAvailability } from "../types.js";
import type { AgentHandle, OrchestratorAdapter, WorkflowHandle } from "./types.js";

/** In-process orchestration fallback when Ruflo is disabled or unavailable. */
export function createLocalOrchestrator(): OrchestratorAdapter {
  const workflows = new Map<string, WorkflowHandle>();
  const agents = new Map<string, AgentHandle>();
  const registry = new Map<string, { role: string; registeredAt: string }>();

  return {
    name: "local",
    async probe(): Promise<AdapterAvailability> {
      return { status: "ready", detail: "local in-process runner" };
    },
    async registerAgent(role: string) {
      const agentId = newId(`agent_${role}`);
      registry.set(agentId, { role, registeredAt: new Date().toISOString() });
      agents.set(agentId, { agentId, status: "idle" });
      return { agentId, status: "idle" as const };
    },
    listAgents() {
      return [...agents.values()];
    },
    workflow: {
      async start(name, input) {
        const handle: WorkflowHandle = {
          workflowId: newId(`wf_${name}`),
          status: "running",
          input,
          startedAt: new Date().toISOString(),
        };
        workflows.set(handle.workflowId, handle);
        return handle;
      },
      async pause(workflowId) {
        return setWorkflow(workflows, workflowId, "paused");
      },
      async resume(workflowId) {
        return setWorkflow(workflows, workflowId, "running");
      },
      async cancel(workflowId) {
        return setWorkflow(workflows, workflowId, "cancelled");
      },
      async status(workflowId) {
        const handle = workflows.get(workflowId);
        if (!handle) {
          throw new ToonForgeError({
            code: "VALIDATION_FAILED",
            message: `Unknown workflow: ${workflowId}`,
            component: "adapters.ruflo.local",
          });
        }
        return handle;
      },
    },
    agent: {
      async dispatch(role, input) {
        const handle: AgentHandle = {
          agentId: newId(`agent_${role}`),
          status: "running",
          role,
          input,
          updatedAt: new Date().toISOString(),
        };
        agents.set(handle.agentId, handle);
        return handle;
      },
      async status(agentId) {
        const handle = agents.get(agentId);
        if (!handle) {
          throw new ToonForgeError({
            code: "VALIDATION_FAILED",
            message: `Unknown agent: ${agentId}`,
            component: "adapters.ruflo.local",
          });
        }
        return handle;
      },
      async retry(agentId) {
        return setAgent(agents, agentId, "running");
      },
      async stop(agentId) {
        return setAgent(agents, agentId, "stopped");
      },
    },
  };
}

function setWorkflow(
  map: Map<string, WorkflowHandle>,
  workflowId: string,
  status: WorkflowHandle["status"],
): WorkflowHandle {
  const current = map.get(workflowId);
  if (!current) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `Unknown workflow: ${workflowId}`,
      component: "adapters.ruflo.local",
    });
  }
  const next = { ...current, status };
  map.set(workflowId, next);
  return next;
}

function setAgent(
  map: Map<string, AgentHandle>,
  agentId: string,
  status: AgentHandle["status"],
): AgentHandle {
  const current = map.get(agentId);
  if (!current) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `Unknown agent: ${agentId}`,
      component: "adapters.ruflo.local",
    });
  }
  const next = { ...current, status };
  map.set(agentId, next);
  return next;
}
