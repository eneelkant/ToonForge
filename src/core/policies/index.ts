/**
 * ToonForge-owned agent policies inspired by publicly documented Karpathy coding guidelines.
 * Upstream README claims MIT but no LICENSE file was present at audit — we do not copy upstream text.
 */

export const PLAN_POLICY = {
  id: "plan",
  summary: "State assumptions, surface ambiguity, push back on overreach before acting.",
} as const;

export const SIMPLICITY_POLICY = {
  id: "simplicity",
  summary: "Prefer the smallest change that satisfies the stated goal; avoid speculative abstractions.",
} as const;

export const SURGICAL_POLICY = {
  id: "surgical",
  summary: "Touch only required surfaces; do not drive-by refactor unrelated code.",
} as const;

export const VERIFY_POLICY = {
  id: "verify",
  summary: "Define success criteria; execute; verify artifacts before advancing workflow state.",
} as const;

export const AGENT_LIFECYCLE = ["PLAN", "CHECK", "EXECUTE", "VERIFY"] as const;
export type AgentLifecyclePhase = (typeof AGENT_LIFECYCLE)[number];
