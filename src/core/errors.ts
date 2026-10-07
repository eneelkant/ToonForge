export type ErrorCode =
  | "CONFIG_INVALID"
  | "KILL_SWITCH"
  | "BUDGET_EXCEEDED"
  | "QA_BLOCK"
  | "POLICY_VIOLATION"
  | "ADAPTER_UNAVAILABLE"
  | "NOT_IMPLEMENTED"
  | "STATE_INVALID"
  | "RETRY_EXHAUSTED"
  | "VALIDATION_FAILED"
  | "DUPLICATE"
  | "UPSTREAM_ERROR"
  | "UNKNOWN";

export interface ToonForgeErrorInit {
  code: ErrorCode;
  message: string;
  component: string;
  retryable?: boolean;
  cause?: unknown;
  context?: Record<string, unknown>;
}

export class ToonForgeError extends Error {
  readonly code: ErrorCode;
  readonly component: string;
  readonly retryable: boolean;
  readonly context: Record<string, unknown>;
  override readonly cause?: unknown;

  constructor(init: ToonForgeErrorInit) {
    super(init.message);
    this.name = "ToonForgeError";
    this.code = init.code;
    this.component = init.component;
    this.retryable = init.retryable ?? false;
    this.cause = init.cause;
    this.context = init.context ?? {};
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      component: this.component,
      retryable: this.retryable,
      context: this.context,
    };
  }
}

export function isRetryable(error: unknown): boolean {
  return error instanceof ToonForgeError ? error.retryable : false;
}
