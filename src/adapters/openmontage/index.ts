import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenMontageConfig } from "../../core/config.js";
import type { AdapterAvailability } from "../types.js";
import { defaultProcessRunner, renderCharacterAnimation } from "./client.js";
import { openMontageError } from "./errors.js";
import { probeOpenMontage } from "./probe.js";
import type { OpenMontageAdapter, OpenMontageHealth, ProcessRunner, RenderCharacterAnimationInput } from "./types.js";

export type { OpenMontageAdapter, OpenMontageHealth, RenderCharacterAnimationResult } from "./types.js";
export { mapCharactersToOpenMontage, openMontageSlug, storyboardToScenePlan } from "./characters.js";
export { inspectOpenMontageRoot } from "./probe.js";

export interface OpenMontageAdapterOptions {
  run?: ProcessRunner;
  runnerPath?: string;
}

export function resolveOpenMontageRunner(explicit?: string): string {
  if (explicit) return explicit;
  const candidates = [
    join(process.cwd(), "scripts", "openmontage_runner.py"),
    join(dirname(fileURLToPath(import.meta.url)), "../../../scripts/openmontage_runner.py"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

export function createOpenMontageAdapter(
  config: OpenMontageConfig,
  options: OpenMontageAdapterOptions = {},
): OpenMontageAdapter {
  const run = options.run ?? defaultProcessRunner();
  const runnerPath = resolveOpenMontageRunner(options.runnerPath);

  function requireEnabled(): void {
    if (!config.enabled) {
      throw openMontageError({
        errorClass: "disabled",
        message: "OpenMontage adapter is disabled (set OPENMONTAGE_ENABLED=true)",
      });
    }
  }

  return {
    name: "openmontage",
    async probe(): Promise<AdapterAvailability> {
      const health = await probeOpenMontage(config, runnerPath, run);
      if (health.status === "disabled") return { status: "disabled", detail: health.detail };
      if (health.status === "ready") return { status: "ready", detail: health.detail };
      return { status: "unavailable", detail: `${health.status}: ${health.detail}` };
    },
    health(): Promise<OpenMontageHealth> {
      return probeOpenMontage(config, runnerPath, run);
    },
    async renderCharacterAnimation(input: RenderCharacterAnimationInput) {
      requireEnabled();
      return renderCharacterAnimation(config, runnerPath, input, run);
    },
  };
}

/** External smoke helper. Skips when the checkout cannot actually run. */
export async function smokeOpenMontage(config: OpenMontageConfig): Promise<{
  skipped: boolean;
  reason?: string;
  ready?: boolean;
  versions?: Record<string, string>;
}> {
  const adapter = createOpenMontageAdapter(config);
  const health = await adapter.health();
  if (health.status !== "ready") {
    return { skipped: true, reason: `${health.status}: ${health.detail}` };
  }
  return { skipped: false, ready: true, versions: health.versions };
}
