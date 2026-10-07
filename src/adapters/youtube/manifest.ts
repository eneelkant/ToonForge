import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PublicationManifest } from "./types.js";

export function hashFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function manifestPath(dataDir: string, idempotencyKey: string): string {
  const safe = idempotencyKey.replace(/[^a-zA-Z0-9:_-]/g, "_");
  return join(dataDir, "publish-manifests", `${safe}.json`);
}

export function loadManifest(dataDir: string, idempotencyKey: string): PublicationManifest | null {
  const path = manifestPath(dataDir, idempotencyKey);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as PublicationManifest;
}

export function saveManifest(dataDir: string, manifest: PublicationManifest): string {
  const path = manifestPath(dataDir, manifest.idempotencyKey);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  return path;
}
