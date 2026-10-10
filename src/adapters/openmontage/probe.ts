import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { OpenMontageConfig } from "../../core/config.js";
import { parseRunnerResponse, runOpenMontage } from "./client.js";
import { sanitizeProcessText } from "./errors.js";
import type { OpenMontageHealth, ProcessRunner } from "./types.js";

const REQUIRED_MARKERS = [
  "tools/character/character_animation.py",
  "tools/tool_registry.py",
  "pipeline_defs/character-animation.yaml",
  "LICENSE",
];

export function inspectOpenMontageRoot(root: string | undefined): OpenMontageHealth {
  if (!root?.trim()) {
    return { status: "invalid_configuration", detail: "OPENMONTAGE_ENABLED is true but OPENMONTAGE_ROOT is empty" };
  }
  if (!isAbsolute(root)) {
    return { status: "invalid_configuration", detail: "OPENMONTAGE_ROOT must be an absolute path", root };
  }
  const abs = resolve(root);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    return { status: "not_installed", detail: `OpenMontage root does not exist: ${abs}`, root: abs };
  }
  const missing = REQUIRED_MARKERS.filter((rel) => !existsSync(resolve(abs, rel)));
  if (missing.length) {
    return {
      status: "not_installed",
      detail: `OpenMontage checkout is missing ${missing.join(", ")}`,
      root: abs,
    };
  }
  return { status: "ready", detail: "OpenMontage checkout markers found", root: abs };
}

export async function probeOpenMontage(
  config: OpenMontageConfig,
  runnerPath: string,
  run: ProcessRunner,
): Promise<OpenMontageHealth> {
  if (!config.enabled) {
    return { status: "disabled", detail: "OPENMONTAGE_ENABLED is not true" };
  }
  const inspected = inspectOpenMontageRoot(config.root);
  if (inspected.status !== "ready") return { ...inspected, python: config.python };
  try {
    const { response } = await runOpenMontage(
      { ...config, maxRetries: 1 },
      runnerPath,
      { operation: "probe" },
      run,
    );
    const parsed = response.ok ? response : parseRunnerResponse(JSON.stringify(response));
    if (!parsed.versions || Object.keys(parsed.versions).length === 0) {
      return {
        status: "health_check_failed",
        detail: "OpenMontage probe returned no tool versions",
        root: inspected.root,
        python: config.python,
      };
    }
    return {
      status: "ready",
      detail: `character animation tools ready (${Object.keys(parsed.versions).length})`,
      root: inspected.root,
      python: config.python,
      versions: parsed.versions,
    };
  } catch (error) {
    const context = error instanceof Error && "context" in error ? (error as { context?: { errorClass?: string } }).context : undefined;
    const errorClass = context?.errorClass;
    const message = sanitizeProcessText(error instanceof Error ? error.message : String(error));
    if (errorClass === "missing_dependencies") {
      return { status: "missing_dependencies", detail: message, root: inspected.root, python: config.python };
    }
    if (errorClass === "not_installed") {
      return { status: "not_installed", detail: message, root: inspected.root, python: config.python };
    }
    if (errorClass === "invalid_configuration") {
      return { status: "invalid_configuration", detail: message, root: inspected.root, python: config.python };
    }
    return { status: "health_check_failed", detail: message, root: inspected.root, python: config.python };
  }
}
