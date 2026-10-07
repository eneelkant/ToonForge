import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { RuntimeConfig } from "../../core/config.js";
import { ToonForgeError } from "../../core/errors.js";
import { rootLogger } from "../../core/logging.js";
import type { AdapterAvailability } from "../types.js";
import { OmniCharHttpClient, type FetchLike } from "./http.js";
import type {
  OmniCharAdapter,
  OmniCharCharacterSummary,
  OmniCharContinuityResult,
  OmniCharEncodeResult,
} from "./types.js";

export type { OmniCharAdapter, OmniCharCharacterSummary, OmniCharContinuityResult, OmniCharEncodeResult } from "./types.js";
export { OmniCharHttpClient } from "./http.js";

const log = rootLogger.child("adapters.omnichar");

export interface OmniCharAdapterOptions {
  fetchImpl?: FetchLike;
}

function requireEnabled(config: RuntimeConfig["omnichar"]): void {
  if (!config.enabled) {
    throw new ToonForgeError({
      code: "ADAPTER_UNAVAILABLE",
      message: "OmniChar adapter is disabled (set OMNICHAR_ENABLED=true)",
      component: "adapters.omnichar",
    });
  }
}

function normalizeSummary(raw: unknown): OmniCharCharacterSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const file = String(obj.file ?? obj.name ?? "");
  if (!file) return null;
  return {
    ...obj,
    file,
    name: obj.name != null ? String(obj.name) : undefined,
    charId: obj.char_id != null ? String(obj.char_id) : obj.charId != null ? String(obj.charId) : undefined,
    refs: typeof obj.refs === "number" ? obj.refs : undefined,
    harvested: typeof obj.harvested === "number" ? obj.harvested : undefined,
    needsRebuild: Boolean(obj.needsRebuild ?? obj.needs_rebuild),
    hints: Array.isArray(obj.hints) ? obj.hints.map(String) : undefined,
  };
}

export function createOmniCharAdapter(
  config: RuntimeConfig["omnichar"],
  options: OmniCharAdapterOptions = {},
): OmniCharAdapter {
  const client =
    config.enabled
      ? new OmniCharHttpClient({
          baseUrl: config.baseUrl,
          timeoutMs: config.timeoutMs,
          maxRetries: config.maxRetries,
          fetchImpl: options.fetchImpl,
        })
      : null;

  async function ensureClient(): Promise<OmniCharHttpClient> {
    requireEnabled(config);
    if (!client) {
      throw new ToonForgeError({
        code: "ADAPTER_UNAVAILABLE",
        message: "OmniChar HTTP client is not configured",
        component: "adapters.omnichar",
      });
    }
    return client;
  }

  const adapter: OmniCharAdapter = {
    name: "omnichar",
    client,
    async probe(): Promise<AdapterAvailability> {
      if (!config.enabled) {
        return { status: "disabled", detail: "OMNICHAR_ENABLED is not true" };
      }
      try {
        const health = await client!.health();
        if (!health.ok) {
          return { status: "unavailable", detail: "health returned non-ok payload" };
        }
        return { status: "ready", detail: config.baseUrl };
      } catch (error) {
        return {
          status: "unavailable",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async resolveCharArtifact(characterDir: string): Promise<string | null> {
      const id = basename(characterDir);
      const candidates = [join(characterDir, `${id}.char`), join(characterDir, "character.char")];
      for (const c of candidates) {
        if (existsSync(c)) return c;
      }
      return null;
    },
    async health() {
      if (!config.enabled || !client) {
        return { ok: false, baseUrl: config.baseUrl, detail: "disabled" };
      }
      try {
        const health = await client.health();
        return {
          ok: health.ok,
          baseUrl: config.baseUrl,
          detail: health.ok ? "healthy" : "unhealthy",
          raw: health.raw,
        };
      } catch (error) {
        return {
          ok: false,
          baseUrl: config.baseUrl,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async listCharacters(): Promise<OmniCharCharacterSummary[]> {
      const http = await ensureClient();
      const value = await http.rpc<unknown>("characters:list", []);
      if (!Array.isArray(value)) {
        throw new ToonForgeError({
          code: "UPSTREAM_ERROR",
          message: "OmniChar characters:list did not return an array",
          component: "adapters.omnichar",
          context: { value },
        });
      }
      return value.map(normalizeSummary).filter((x): x is OmniCharCharacterSummary => Boolean(x));
    },
    async getCharacter(fileOrName: string): Promise<OmniCharCharacterSummary | null> {
      const list = await adapter.listCharacters();
      const needle = fileOrName.toLowerCase();
      return (
        list.find(
          (c) =>
            c.file.toLowerCase() === needle ||
            c.file.toLowerCase() === `${needle}.char` ||
            (c.name && c.name.toLowerCase() === needle) ||
            (c.charId && c.charId.toLowerCase() === needle),
        ) ?? null
      );
    },
    async encodeFromTake(takeId: string, name: string): Promise<OmniCharEncodeResult> {
      if (!takeId.trim() || !name.trim()) {
        throw new ToonForgeError({
          code: "VALIDATION_FAILED",
          message: "takeId and name are required for OmniChar encodeFromTake",
          component: "adapters.omnichar",
        });
      }
      const http = await ensureClient();
      log.info("omnichar.encodeFromTake", { takeId, name });
      const value = await http.rpc<unknown>("characters:createFromTake", [takeId, name]);
      const summary = normalizeSummary(value) ?? { file: `${name}.char`, name };
      return { file: summary.file, summary, method: "createFromTake" };
    },
    async uploadCharFile(bytes: Uint8Array, filename = "character.char"): Promise<OmniCharEncodeResult> {
      if (!bytes.length) {
        throw new ToonForgeError({
          code: "VALIDATION_FAILED",
          message: "Cannot upload empty .char file",
          component: "adapters.omnichar",
        });
      }
      const http = await ensureClient();
      log.info("omnichar.uploadCharFile", { filename, bytes: bytes.length });
      const uploaded = await http.uploadCharacter(bytes, filename);
      const summary = await adapter.getCharacter(uploaded.file);
      return { file: uploaded.file, summary: summary ?? { file: uploaded.file }, method: "upload" };
    },
    async validateContinuity(fileOrName: string): Promise<OmniCharContinuityResult> {
      const summary = await adapter.getCharacter(fileOrName);
      if (!summary) {
        return {
          character: fileOrName,
          ok: false,
          needsRebuild: true,
          detail: "Character not found in OmniChar library",
        };
      }
      const needsRebuild = Boolean(summary.needsRebuild);
      return {
        character: summary.file,
        ok: !needsRebuild,
        needsRebuild,
        detail: needsRebuild
          ? "Character scoring/payload needs rebuild (upstream needsRebuild=true)"
          : "Character present and does not report needsRebuild",
        summary,
      };
    },
  };

  return adapter;
}

/** Convenience: upload a local `.char` path into OmniChar when enabled. */
export async function syncLocalCharFile(
  adapter: OmniCharAdapter,
  localPath: string,
): Promise<OmniCharEncodeResult> {
  if (!existsSync(localPath)) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `Local .char not found: ${localPath}`,
      component: "adapters.omnichar",
    });
  }
  const bytes = new Uint8Array(readFileSync(localPath));
  return adapter.uploadCharFile(bytes, basename(localPath));
}
