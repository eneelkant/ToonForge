import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Directory that contains package.json when running from src/ via tsx or from dist/. */
export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

/** Prefer a cwd-relative path, then the same path inside the installed package. */
export function resolveBundled(relativePath: string, cwd = process.cwd()): string {
  const local = resolve(cwd, relativePath);
  if (existsSync(local)) return local;
  const bundled = resolve(packageRoot(), relativePath);
  if (existsSync(bundled)) return bundled;
  return local;
}

export function defaultChannelPath(cwd = process.cwd()): string {
  return resolveBundled("config/channels/cartoon-default.yaml", cwd);
}
