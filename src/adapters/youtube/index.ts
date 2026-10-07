import { ToonForgeError } from "../../core/errors.js";
import type { RuntimeConfig } from "../../core/config.js";
import type { AdapterAvailability } from "../types.js";
import type {
  YoutubeAdapter,
  YoutubeMetadata,
  YoutubeUploadRequest,
  YoutubeUploadResult,
} from "./types.js";

export type {
  YoutubeAdapter,
  YoutubeMetadata,
  YoutubeUploadRequest,
  YoutubeUploadResult,
} from "./types.js";

/**
 * Canonical upstream reference (resolved):
 * https://github.com/darkzOGx/youtube-automation-agent
 *
 * The brief URL with a trailing dash does not exist. This adapter is interface-first;
 * googleapis OAuth upload lands in a later feature branch.
 */
export function createYoutubeAdapter(config: RuntimeConfig["youtube"]): YoutubeAdapter {
  let paused = false;

  return {
    name: "youtube",
    async probe(): Promise<AdapterAvailability> {
      if (!config.clientId || !config.clientSecret) {
        return {
          status: "unavailable",
          detail: "YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET not configured",
        };
      }
      return {
        status: "disabled",
        detail: "Credentials present but OAuth client not implemented in foundation phase",
      };
    },
    async authenticate() {
      return {
        ok: false,
        detail: "YouTube OAuth not implemented yet (foundation interface only)",
      };
    },
    async validate_metadata(metadata: YoutubeMetadata) {
      const errors: string[] = [];
      if (!metadata.title?.trim()) errors.push("title required");
      if (!metadata.description?.trim()) errors.push("description required");
      if (!metadata.privacyStatus) errors.push("privacyStatus required");
      return { ok: errors.length === 0, errors };
    },
    async upload(req: YoutubeUploadRequest): Promise<YoutubeUploadResult> {
      if (paused) {
        throw new ToonForgeError({
          code: "POLICY_VIOLATION",
          message: "Publishing is paused",
          component: "adapters.youtube",
        });
      }
      const validation = await this.validate_metadata(req.metadata);
      if (!validation.ok) {
        throw new ToonForgeError({
          code: "VALIDATION_FAILED",
          message: "Invalid YouTube metadata",
          component: "adapters.youtube",
          context: { errors: validation.errors, idempotencyKey: req.idempotencyKey },
        });
      }
      return {
        status: "stub",
        detail: `Upload stubbed for idempotency key ${req.idempotencyKey}`,
      };
    },
    async schedule(req) {
      return this.upload(req);
    },
    async publish(req) {
      return this.upload(req);
    },
    async update() {
      throw new ToonForgeError({
        code: "NOT_IMPLEMENTED",
        message: "YouTube update not implemented",
        component: "adapters.youtube",
      });
    },
    async get_video() {
      throw new ToonForgeError({
        code: "NOT_IMPLEMENTED",
        message: "YouTube get_video not implemented",
        component: "adapters.youtube",
      });
    },
    async get_analytics() {
      throw new ToonForgeError({
        code: "NOT_IMPLEMENTED",
        message: "YouTube get_analytics not implemented",
        component: "adapters.youtube",
      });
    },
    async pause_publishing() {
      paused = true;
    },
  };
}
