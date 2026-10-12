import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

/** Repository root derived from this module, not from the caller's working directory. */
export function projectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

export function defaultProjectEnvPath(): string {
  return resolve(projectRoot(), ".env");
}

/**
 * Path of the env file to read, or null when loading is intentionally skipped.
 * `TOONFORGE_ENV_FILE` is an explicit path, not a search. Tests skip the
 * developer `.env` unless that override is set.
 */
export function resolveEnvFilePath(env: NodeJS.ProcessEnv): string | null {
  const override = env.TOONFORGE_ENV_FILE?.trim();
  if (override === "off") return null;
  if (override) return resolve(override);
  if (env.VITEST) return null;
  return defaultProjectEnvPath();
}

/** Copy keys from env-file text. Values already present on `env` stay in place. */
export function applyEnvText(content: string, env: NodeJS.ProcessEnv): string[] {
  const parsed = parseEnv(content);
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] !== undefined) continue;
    env[key] = value;
    applied.push(key);
  }
  return applied;
}

export function loadProjectEnv(env: NodeJS.ProcessEnv = process.env): { path: string | null; loaded: boolean; applied: string[] } {
  const path = resolveEnvFilePath(env);
  if (!path || !existsSync(path)) return { path, loaded: false, applied: [] };
  const applied = applyEnvText(readFileSync(path, "utf8"), env);
  return { path, loaded: true, applied };
}

export function missingYoutubeOAuthVars(source: {
  YOUTUBE_CLIENT_ID?: string;
  YOUTUBE_CLIENT_SECRET?: string;
  clientId?: string;
  clientSecret?: string;
}): string[] {
  const clientId = source.clientId ?? source.YOUTUBE_CLIENT_ID;
  const clientSecret = source.clientSecret ?? source.YOUTUBE_CLIENT_SECRET;
  const missing: string[] = [];
  if (!clientId?.trim()) missing.push("YOUTUBE_CLIENT_ID");
  if (!clientSecret?.trim()) missing.push("YOUTUBE_CLIENT_SECRET");
  return missing;
}

export function youtubeOAuthMissingMessage(missing: readonly string[]): string {
  return `YouTube OAuth configuration is incomplete. Missing: ${missing.join(", ")}. Configure these in the local environment or ignored .env file.`;
}
