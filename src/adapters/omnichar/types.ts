import type { AdapterProbe } from "../types.js";

/**
 * OmniChar is GPL-3.0-or-later. Implementations MUST talk to an external process/HTTP
 * server and must not import OmniChar Python packages into the ToonForge Node process.
 */
export interface OmniCharAdapter extends AdapterProbe {
  name: "omnichar";
  /** Resolve a ToonForge character folder to an optional `.char` artifact path. */
  resolveCharArtifact(characterDir: string): Promise<string | null>;
  /** Later: submit encode/score via upstream `/v1/runs` — not implemented in foundation. */
  health(): Promise<{ ok: boolean; baseUrl: string; detail?: string }>;
}
