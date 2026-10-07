import { ToonForgeError, isRetryable } from "./errors.js";

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs?: number;
  component: string;
  onRetry?: (attempt: number, error: unknown) => void;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts);
  const baseDelayMs = options.baseDelayMs ?? 250;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === maxAttempts) break;
      options.onRetry?.(attempt, error);
      await sleep(baseDelayMs * attempt);
    }
  }

  throw new ToonForgeError({
    code: "RETRY_EXHAUSTED",
    message: `Retries exhausted after ${maxAttempts} attempt(s)`,
    component: options.component,
    retryable: false,
    cause: lastError,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
