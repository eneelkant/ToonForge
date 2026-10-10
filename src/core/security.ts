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
  if (BLOCKED_HOSTS.has(url.hostname) || isPrivateHost(url.hostname)) {
    throw new ToonForgeError({
      code: "POLICY_VIOLATION",
      message: "Blocked host",
      component: "core.security",
      context: { host: url.hostname },
    });
  }
  return url;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0") return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!v4) return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
  const octets = [Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4])];
  const a = octets[0] ?? 0;
  const b = octets[1] ?? 0;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
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
