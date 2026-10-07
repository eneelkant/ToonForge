import { existsSync } from "node:fs";
import type { RuntimeConfig } from "../../core/config.js";
import { ToonForgeError } from "../../core/errors.js";
import { rootLogger } from "../../core/logging.js";
import { publishIdempotencyKey } from "../../core/ids.js";
import type { AdapterAvailability } from "../types.js";
import { assertPublishable } from "./gates.js";
import { hashFile, loadManifest, saveManifest } from "./manifest.js";
import { createGoogleYoutubeClient, loadTokenFile } from "./oauth.js";
import type {
  PublicationManifest,
  YoutubeAdapter,
  YoutubeApiClient,
  YoutubeMetadata,
  YoutubeUploadRequest,
  YoutubeUploadResult,
} from "./types.js";

export type {
  PublicationManifest,
  YoutubeAdapter,
  YoutubeApiClient,
  YoutubeMetadata,
  YoutubeUploadRequest,
  YoutubeUploadResult,
} from "./types.js";
export { getAuthUrl, createGoogleYoutubeClient, loadTokenFile, saveTokenFile } from "./oauth.js";
export { assertPublishable } from "./gates.js";

const log = rootLogger.child("adapters.youtube");

export interface YoutubeAdapterOptions {
  apiClient?: YoutubeApiClient;
  dataDir?: string;
  dryRunDefault?: boolean;
}

export function createYoutubeAdapter(
  config: RuntimeConfig["youtube"],
  options: YoutubeAdapterOptions = {},
): YoutubeAdapter {
  let paused = false;
  const dataDir = options.dataDir ?? "./data";
  const dryRunDefault = options.dryRunDefault ?? config.dryRunDefault ?? true;

  function resolveClient(): YoutubeApiClient {
    if (options.apiClient) return options.apiClient;
    return createGoogleYoutubeClient(config);
  }

  async function validate_metadata(metadata: YoutubeMetadata) {
    const errors: string[] = [];
    if (!metadata.title?.trim()) errors.push("title required");
    if (metadata.title && metadata.title.length > 100) errors.push("title exceeds 100 characters");
    if (!metadata.description?.trim()) errors.push("description required");
    if (!metadata.privacyStatus) errors.push("privacyStatus required");
    if (metadata.scheduledStartTime && Number.isNaN(Date.parse(metadata.scheduledStartTime))) {
      errors.push("scheduledStartTime must be ISO-8601");
    }
    return { ok: errors.length === 0, errors };
  }

  async function publishInternal(req: YoutubeUploadRequest): Promise<YoutubeUploadResult> {
    if (paused) {
      throw new ToonForgeError({
        code: "POLICY_VIOLATION",
        message: "Publishing is paused",
        component: "adapters.youtube",
      });
    }

    const idempotencyKey =
      req.idempotencyKey || publishIdempotencyKey(req.projectId, req.videoId);
    const existing = loadManifest(dataDir, idempotencyKey);
    if (existing && (existing.publishStatus === "published" || existing.publishStatus === "scheduled" || existing.publishStatus === "dry_run")) {
      log.info("youtube.idempotent_hit", { idempotencyKey, status: existing.publishStatus });
      return {
        youtubeId: existing.youtubeId,
        status: existing.publishStatus,
        detail: "Idempotent replay of existing publication manifest",
        idempotencyKey,
      };
    }

    const validation = await validate_metadata(req.metadata);
    if (!validation.ok) {
      throw new ToonForgeError({
        code: "VALIDATION_FAILED",
        message: "Invalid YouTube metadata",
        component: "adapters.youtube",
        context: { errors: validation.errors },
      });
    }

    const dryRun = req.dryRun ?? dryRunDefault;
    await assertPublishable({ ...req, idempotencyKey, dryRun });

    if (!dryRun && (!config.clientId || !config.clientSecret)) {
      throw new ToonForgeError({
        code: "CONFIG_INVALID",
        message: "Live YouTube publish requires YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET",
        component: "adapters.youtube",
      });
    }

    const manifest: PublicationManifest = {
      projectId: req.projectId,
      videoId: req.videoId,
      referenceIds: [],
      characterIds: [],
      artifacts: {
        videoPath: req.videoPath,
        thumbnailPath: req.metadata.thumbnailPath,
      },
      hashes: {
        video: hashFile(req.videoPath),
        audio: undefined,
      },
      qaResult: req.qaStatus ?? "PASS",
      policyResult: req.policyStatus ?? "PASS",
      provenance: req.provenance ?? {
        originalContent: true,
        thirdPartyFootage: false,
        licensedAssets: [],
        notes: ["default provenance"],
      },
      timestamp: new Date().toISOString(),
      publishStatus: dryRun ? "dry_run" : "failed",
      idempotencyKey,
    };

    if (dryRun) {
      saveManifest(dataDir, manifest);
      log.info("youtube.dry_run", { idempotencyKey, projectId: req.projectId });
      return {
        status: "dry_run",
        detail: "Dry-run: publication manifest saved; no YouTube upload performed",
        idempotencyKey,
      };
    }

    try {
      const api = resolveClient();
      const uploaded = await api.uploadVideo({
        videoPath: req.videoPath,
        metadata: req.metadata,
      });
      if (req.metadata.thumbnailPath) {
        await api.setThumbnail(uploaded.youtubeId, req.metadata.thumbnailPath);
      }
      if (req.metadata.playlistId && api.addToPlaylist) {
        await api.addToPlaylist(uploaded.youtubeId, req.metadata.playlistId);
      }
      const status: YoutubeUploadResult["status"] = req.metadata.scheduledStartTime
        ? "scheduled"
        : "published";
      manifest.youtubeId = uploaded.youtubeId;
      manifest.publishStatus = status;
      saveManifest(dataDir, manifest);
      return {
        youtubeId: uploaded.youtubeId,
        status,
        detail: "Uploaded via YouTube Data API",
        idempotencyKey,
      };
    } catch (error) {
      if (error instanceof ToonForgeError && /no video id/i.test(error.message)) {
        manifest.publishStatus = "reconciliation_required";
        saveManifest(dataDir, manifest);
        return {
          status: "reconciliation_required",
          detail: error.message,
          idempotencyKey,
        };
      }
      throw error;
    }
  }

  return {
    name: "youtube",
    async probe(): Promise<AdapterAvailability> {
      if (!config.clientId || !config.clientSecret) {
        return {
          status: "unavailable",
          detail: "YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET not configured",
        };
      }
      const token = loadTokenFile(config.tokenPath);
      if (!token && !options.apiClient) {
        return {
          status: "unavailable",
          detail: `OAuth token missing at ${config.tokenPath}`,
        };
      }
      if (dryRunDefault) {
        return { status: "ready", detail: "credentials present; dry-run default enabled" };
      }
      return { status: "ready", detail: "credentials and token present" };
    },
    async authenticate() {
      if (!config.clientId || !config.clientSecret) {
        return { ok: false, detail: "Missing YOUTUBE_CLIENT_ID/SECRET" };
      }
      if (options.apiClient) return { ok: true, detail: "Injected API client" };
      const token = loadTokenFile(config.tokenPath);
      if (!token) {
        return {
          ok: false,
          detail: `No token at ${config.tokenPath}. Use getAuthUrl() and exchange the code offline.`,
        };
      }
      return { ok: true, detail: "Token file present (contents not logged)" };
    },
    validate_metadata,
    upload: publishInternal,
    schedule: publishInternal,
    publish: publishInternal,
    async update(youtubeId, metadata) {
      await resolveClient().updateVideo(youtubeId, metadata);
    },
    async get_video(youtubeId) {
      return resolveClient().getVideo(youtubeId);
    },
    async get_analytics(youtubeId) {
      return resolveClient().getAnalytics(youtubeId);
    },
    async pause_publishing() {
      paused = true;
    },
    async resume_publishing() {
      paused = false;
    },
    async getManifest(idempotencyKey) {
      return loadManifest(dataDir, idempotencyKey);
    },
  };
}

export function assertVideoFile(path: string): void {
  if (!existsSync(path)) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `Missing video: ${path}`,
      component: "adapters.youtube",
    });
  }
}
