import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { OpenMontageConfig } from "../../core/config.js";
import { ToonForgeError } from "../../core/errors.js";
import { rootLogger } from "../../core/logging.js";
import { mapCharactersToOpenMontage, storyboardToScenePlan } from "./characters.js";
import { openMontageError, sanitizeProcessText } from "./errors.js";
import type {
  ProcessRunner,
  ProcessRunResult,
  RenderCharacterAnimationInput,
  RenderCharacterAnimationResult,
  RunnerResponse,
} from "./types.js";

const log = rootLogger.child("adapters.openmontage");

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/TOKEN|SECRET|PASSWORD|API[_-]?KEY|AUTHORIZATION|CREDENTIAL/i.test(key)) {
      delete env[key];
    }
  }
  return env;
}

export function defaultProcessRunner(): ProcessRunner {
  return (request) =>
    new Promise((done, reject) => {
      const started = Date.now();
      const child = execFile(
        request.command,
        request.args,
        {
          cwd: request.cwd,
          timeout: request.timeoutMs,
          maxBuffer: 8 * 1024 * 1024,
          env: childEnv(),
        },
        (error, stdout, stderr) => {
          const timedOut = Boolean(error && "killed" in error && error.killed && error.signal === "SIGTERM");
          const code = typeof error?.code === "number" ? error.code : error ? 1 : 0;
          if (error && error.code === "ENOENT") {
            reject(
              openMontageError({
                errorClass: "invalid_configuration",
                message: `Python executable not found: ${request.command}`,
                cause: error,
              }),
            );
            return;
          }
          done({
            code,
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
            durationMs: Date.now() - started,
            timedOut: timedOut || /ETIMEDOUT|timed out/i.test(error?.message ?? ""),
          });
        },
      );
      // Write stdin directly. Node 22.14 ignores execFile's `input` option.
      child.stdin?.end(request.input);
    });
}

export function assertInsideWorkspace(workspace: string, candidate: string): string {
  if (!isAbsolute(workspace) || !isAbsolute(candidate)) {
    throw openMontageError({
      errorClass: "path_traversal",
      message: "OpenMontage workspace and output paths must be absolute",
      context: { workspace, candidate },
    });
  }
  const root = resolve(workspace);
  const target = resolve(candidate);
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel.split(sep).includes("..") || isAbsolute(rel)) {
    throw openMontageError({
      errorClass: "path_traversal",
      message: "OpenMontage refused a path outside the project workspace",
      context: { workspace: root, candidate: target },
    });
  }
  return target;
}

export function parseRunnerResponse(stdout: string): RunnerResponse {
  const line = stdout
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .reverse()
    .find((item) => item.startsWith("{"));
  if (!line) {
    throw openMontageError({
      errorClass: "execution_failure",
      message: "OpenMontage runner returned no JSON result",
    });
  }
  try {
    return JSON.parse(line) as RunnerResponse;
  } catch (error) {
    throw openMontageError({
      errorClass: "execution_failure",
      message: "OpenMontage runner returned invalid JSON",
      cause: error,
    });
  }
}

function classifyRunnerFailure(result: ProcessRunResult, parsed?: RunnerResponse): never {
  if (result.timedOut) {
    throw openMontageError({
      errorClass: "timeout",
      message: `OpenMontage timed out after ${result.durationMs}ms`,
      retryable: true,
      context: { stderr: sanitizeProcessText(result.stderr) },
    });
  }
  const errorClass = parsed?.error_class;
  if (errorClass) {
    throw openMontageError({
      errorClass,
      message: sanitizeProcessText(parsed?.message || "OpenMontage runner failed"),
      retryable: errorClass === "timeout",
    });
  }
  throw openMontageError({
    errorClass: "execution_failure",
    message: sanitizeProcessText(result.stderr || result.stdout || `OpenMontage exited ${result.code}`),
    retryable: false,
  });
}

export async function runOpenMontage(
  config: OpenMontageConfig,
  runnerPath: string,
  payload: Record<string, unknown>,
  run: ProcessRunner,
): Promise<{ response: RunnerResponse; durationMs: number; attempts: number }> {
  if (!config.python) {
    throw openMontageError({
      errorClass: "invalid_configuration",
      message: "OPENMONTAGE_PYTHON is empty",
    });
  }
  if (!config.root) {
    throw openMontageError({
      errorClass: "invalid_configuration",
      message: "OPENMONTAGE_ROOT is required when OpenMontage is enabled",
    });
  }
  if (!existsSync(runnerPath)) {
    throw openMontageError({
      errorClass: "invalid_configuration",
      message: `OpenMontage runner script is missing: ${runnerPath}`,
    });
  }
  const input = JSON.stringify({ ...payload, root: config.root });
  const maxAttempts = Math.max(1, config.maxRetries);
  let attempts = 0;
  let response: RunnerResponse | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    try {
      const result = await run({
        command: config.python,
        args: [runnerPath],
        cwd: config.root!,
        timeoutMs: config.timeoutMs,
        input,
      });
      let parsed: RunnerResponse | undefined;
      if (result.stdout.trim()) {
        try {
          parsed = parseRunnerResponse(result.stdout);
        } catch (error) {
          if (result.timedOut) classifyRunnerFailure(result);
          if (result.code === 0) throw error;
        }
      }
      if (result.timedOut || result.code !== 0 || !parsed?.ok) {
        classifyRunnerFailure(result, parsed);
      }
      response = parsed!;
      break;
    } catch (error) {
      const retryable = error instanceof ToonForgeError && error.retryable;
      if (!retryable || attempt === maxAttempts) throw error;
      log.warn("openmontage.retry", { attempt, errorClass: error.context.errorClass });
    }
  }
  if (!response) {
    throw openMontageError({
      errorClass: "execution_failure",
      message: "OpenMontage runner produced no result",
    });
  }
  return { response, durationMs: 0, attempts };
}

export async function renderCharacterAnimation(
  config: OpenMontageConfig,
  runnerPath: string,
  input: RenderCharacterAnimationInput,
  run: ProcessRunner,
): Promise<RenderCharacterAnimationResult> {
  const mapping = mapCharactersToOpenMontage(input.characters);
  const scenePlan = storyboardToScenePlan(input.storyboard);
  const workspace = resolve(input.workspace);
  const videoPath = assertInsideWorkspace(workspace, resolve(workspace, "video.mp4"));
  const estimatedCostUsd = 0;
  const started = Date.now();
  const { response, attempts } = await runOpenMontage(
    config,
    runnerPath,
    {
      operation: "render",
      workspace,
      video_output_path: videoPath,
      characters: mapping.characters,
      scene_plan: { version: scenePlan.version, scenes: scenePlan.scenes },
      style: { visual_style: input.visualStyle || mapping.characters[0]?.style || "cartoon" },
      brief: input.brief,
      duration_seconds: input.durationSeconds,
      fps: input.fps ?? 12,
      preserved_locally: mapping.preservedLocally,
    },
    run,
  );
  if (!response.video_path) {
    throw openMontageError({
      errorClass: "invalid_output",
      message: "OpenMontage reported success without a video_path",
    });
  }
  const verifiedVideo = assertInsideWorkspace(workspace, response.video_path);
  if (!existsSync(verifiedVideo)) {
    throw openMontageError({
      errorClass: "invalid_output",
      message: "OpenMontage video_path does not exist",
      context: { videoPath: verifiedVideo },
    });
  }
  const ids = response.character_ids ?? [];
  const names = response.display_names ?? [];
  for (const spec of mapping.characters) {
    if (!ids.includes(spec.id) || !names.includes(spec.display_name)) {
      throw openMontageError({
        errorClass: "compatibility",
        message: `OpenMontage output dropped character identity for ${spec.id}`,
        context: { characterId: spec.id, ids, names },
      });
    }
  }
  const artifacts = (response.artifacts ?? []).map((path) => assertInsideWorkspace(workspace, path));
  log.info("openmontage.render", {
    workspace,
    attempts,
    versions: response.versions ?? {},
    costUsd: response.cost_usd ?? 0,
  });
  return {
    videoPath: verifiedVideo,
    artifactPaths: artifacts,
    versions: response.versions ?? {},
    characterIds: ids,
    displayNames: names,
    durationMs: Date.now() - started,
    retryCount: Math.max(0, attempts - 1),
    estimatedCostUsd,
    actualCostUsd: typeof response.cost_usd === "number" ? response.cost_usd : 0,
    approval: {
      agentPipeline: "not_invoked",
      detail:
        response.approval?.detail ??
        "Deterministic tool execute() only. Agent checkpoint approvals were not simulated.",
    },
    previewPath: response.preview_path ? assertInsideWorkspace(workspace, response.preview_path) : undefined,
  };
}
