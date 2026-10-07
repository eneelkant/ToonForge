import { ToonForgeError } from "./errors.js";

const BLOCKED_HOSTS = new Set(["metadata.google.internal", "169.254.169.254"]);

export function assertSafeExternalUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: "Invalid URL",
      component: "core.security",
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ToonForgeError({
      code: "POLICY_VIOLATION",
      message: "Only http(s) URLs are allowed",
      component: "core.security",
    });
  }
  if (BLOCKED_HOSTS.has(url.hostname)) {
    throw new ToonForgeError({
      code: "POLICY_VIOLATION",
      message: "Blocked host",
      component: "core.security",
      context: { host: url.hostname },
    });
  }
  return url;
}

export function assertSafeRelativePath(path: string): void {
  if (path.includes("\0") || path.split(/[\\/]/).includes("..")) {
    throw new ToonForgeError({
      code: "POLICY_VIOLATION",
      message: "Path traversal blocked",
      component: "core.security",
      context: { path },
    });
  }
}

export function redactSecrets<T extends Record<string, unknown>>(obj: T): T {
  const copy = { ...obj };
  for (const key of Object.keys(copy)) {
    if (/token|secret|password|api[_-]?key/i.test(key)) {
      (copy as Record<string, unknown>)[key] = "[REDACTED]";
    }
  }
  return copy;
}
