export type PolicyVerdict = "allow" | "warn" | "deny";

export interface PolicyResult {
  policy: string;
  verdict: PolicyVerdict;
  reason: string;
}

export interface AgentActionContext {
  goal: string;
  assumptions: string[];
  plannedSteps: string[];
  successCriteria: string[];
  irreversible?: boolean;
}

/** PLAN → CHECK → EXECUTE → VERIFY lifecycle gates (Karpathy-inspired, ToonForge-owned). */
export function evaluatePlan(ctx: AgentActionContext): PolicyResult[] {
  const results: PolicyResult[] = [];

  if (!ctx.goal.trim()) {
    results.push({ policy: "plan.goal", verdict: "deny", reason: "Goal is required" });
  } else {
    results.push({ policy: "plan.goal", verdict: "allow", reason: "Goal present" });
  }

  if (ctx.assumptions.length === 0) {
    results.push({
      policy: "plan.assumptions",
      verdict: "warn",
      reason: "No assumptions stated; prefer explicit assumptions",
    });
  } else {
    results.push({ policy: "plan.assumptions", verdict: "allow", reason: "Assumptions listed" });
  }

  if (ctx.plannedSteps.length === 0) {
    results.push({ policy: "plan.steps", verdict: "deny", reason: "No steps planned" });
  } else {
    results.push({ policy: "plan.steps", verdict: "allow", reason: "Steps present" });
  }

  if (ctx.successCriteria.length === 0) {
    results.push({
      policy: "verify.criteria",
      verdict: "deny",
      reason: "Success criteria required before execute",
    });
  } else {
    results.push({ policy: "verify.criteria", verdict: "allow", reason: "Criteria present" });
  }

  if (ctx.irreversible && ctx.successCriteria.length < 1) {
    results.push({
      policy: "execute.irreversible",
      verdict: "deny",
      reason: "Irreversible actions require verified success criteria",
    });
  }

  return results;
}

export function isDenied(results: PolicyResult[]): boolean {
  return results.some((r) => r.verdict === "deny");
}
