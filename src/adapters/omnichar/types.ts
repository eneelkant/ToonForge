import type { AdapterProbe } from "../types.js";
import type { OmniCharHttpClient } from "./http.js";

/**
 * OmniChar is GPL-3.0-or-later. Implementations MUST talk to an external process/HTTP
 * server and must not import OmniChar Python packages into the ToonForge Node process.
 *
 * Verified upstream surfaces (2026-10-07):
 * - GET /v1/health, /v1/models, /v1/runs, POST /v1/runs, POST /v1/assets, takes
 * - POST /rpc { channel, args } — Studio channels including characters:list|createFromTake|delete
 * - POST /upload/character, GET /download/character/{name}
 */
export interface OmniCharCharacterSummary {
  file: string;
  name?: string;
  charId?: string;
  refs?: number;
  harvested?: number;
  needsRebuild?: boolean;
  hints?: string[];
  [key: string]: unknown;
}

export interface OmniCharEncodeResult {
  file: string;
  summary?: OmniCharCharacterSummary;
  method: "createFromTake" | "upload";
}

export interface OmniCharContinuityResult {
  character: string;
  ok: boolean;
  needsRebuild: boolean;
  detail: string;
  summary?: OmniCharCharacterSummary;
}

export interface OmniCharAdapter extends AdapterProbe {
  name: "omnichar";
  client: OmniCharHttpClient | null;
  /** Resolve a ToonForge character folder to an optional `.char` artifact path. */
  resolveCharArtifact(characterDir: string): Promise<string | null>;
  health(): Promise<{ ok: boolean; baseUrl: string; detail?: string; raw?: unknown }>;
  listCharacters(): Promise<OmniCharCharacterSummary[]>;
  getCharacter(fileOrName: string): Promise<OmniCharCharacterSummary | null>;
  /** Encode a character from an OmniChar take id (upstream characters:createFromTake). */
  encodeFromTake(takeId: string, name: string): Promise<OmniCharEncodeResult>;
  /** Upload an existing `.char` archive into OmniChar's library. */
  uploadCharFile(bytes: Uint8Array, filename?: string): Promise<OmniCharEncodeResult>;
  /** Continuity/validation using list metadata (needsRebuild / presence). */
  validateContinuity(fileOrName: string): Promise<OmniCharContinuityResult>;
}
