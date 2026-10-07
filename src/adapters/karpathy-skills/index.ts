import { AGENT_LIFECYCLE, PLAN_POLICY, SIMPLICITY_POLICY, SURGICAL_POLICY, VERIFY_POLICY } from "../../core/policies/index.js";

/**
 * Maps audited Karpathy-skills concepts into ToonForge policy IDs.
 * Does not vendor upstream markdown (license file missing at audit).
 */
export function getKarpathyGuidanceMapping() {
  return {
    upstream: "https://github.com/multica-ai/andrej-karpathy-skills",
    licenseNote: "README claims MIT; no LICENSE file verified; guidance-only",
    lifecycle: AGENT_LIFECYCLE,
    policies: [PLAN_POLICY, SIMPLICITY_POLICY, SURGICAL_POLICY, VERIFY_POLICY],
  };
}
