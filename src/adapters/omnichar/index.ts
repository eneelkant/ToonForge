import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeConfig } from "../../core/config.js";
import type { AdapterAvailability } from "../types.js";
import type { OmniCharAdapter } from "./types.js";

export type { OmniCharAdapter } from "./types.js";

export function createOmniCharAdapter(config: RuntimeConfig["omnichar"]): OmniCharAdapter {
  return {
    name: "omnichar",
    async probe(): Promise<AdapterAvailability> {
      if (!config.enabled) {
        return { status: "disabled", detail: "OMNICHAR_ENABLED is not true" };
      }
      try {
        const res = await fetch(`${config.baseUrl}/v1/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (!res.ok) {
          return {
            status: "unavailable",
            detail: `HTTP ${res.status} from ${config.baseUrl}/v1/health`,
          };
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
      // Convention: characters/<id>/<id>.char if present; OmniChar encode runs later via HTTP.
      const candidates = [
        join(characterDir, `${characterDir.split(/[\\/]/).pop()}.char`),
        join(characterDir, "character.char"),
      ];
      for (const c of candidates) {
        if (existsSync(c)) return c;
      }
      return null;
    },
    async health() {
      const availability = await this.probe();
      return {
        ok: availability.status === "ready",
        baseUrl: config.baseUrl,
        detail: availability.detail,
      };
    },
  };
}
