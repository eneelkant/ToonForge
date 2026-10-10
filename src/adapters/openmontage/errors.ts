import { ToonForgeError, type ErrorCode } from "../../core/errors.js";

/** Distinguishes OpenMontage failures without leaking process output. */
export type OpenMontageErrorClass =
  | "disabled"
  | "not_installed"
  | "missing_dependencies"
  | "invalid_configuration"
  | "health_check_failed"
  | "timeout"
  | "execution_failure"
  | "invalid_output"
  | "path_traversal"
  | "compatibility";

const CODE_BY_CLASS: Record<OpenMontageErrorClass, ErrorCode> = {
  disabled: "ADAPTER_UNAVAILABLE",
  not_installed: "ADAPTER_UNAVAILABLE",
  missing_dependencies: "ADAPTER_UNAVAILABLE",
  invalid_configuration: "CONFIG_INVALID",
  health_check_failed: "UPSTREAM_ERROR",
  timeout: "UPSTREAM_ERROR",
  execution_failure: "UPSTREAM_ERROR",
  invalid_output: "VALIDATION_FAILED",
  path_traversal: "POLICY_VIOLATION",
  compatibility: "VALIDATION_FAILED",
};

export function openMontageError(input: {
  errorClass: OpenMontageErrorClass;
  message: string;
  retryable?: boolean;
  context?: Record<string, unknown>;
  cause?: unknown;
}): ToonForgeError {
  return new ToonForgeError({
    code: CODE_BY_CLASS[input.errorClass],
    message: input.message,
    component: "adapters.openmontage",
    retryable: input.retryable ?? input.errorClass === "timeout",
    cause: input.cause,
    context: { errorClass: input.errorClass, ...(input.context ?? {}) },
  });
}

/** Strip credential-shaped text from upstream stderr/stdout before logging. */
export function sanitizeProcessText(text: string, limit = 2000): string {
  return text
    .replace(/(authorization|bearer)\s+[A-Za-z0-9._\-+/=]+/gi, "$1 [REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)(\S+)/gi, "$1[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .slice(0, limit);
}
