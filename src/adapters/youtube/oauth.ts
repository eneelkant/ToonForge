import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { google } from "googleapis";
import { ToonForgeError } from "../../core/errors.js";
import { rootLogger } from "../../core/logging.js";
import type { RuntimeConfig } from "../../core/config.js";
import type { YoutubeApiClient, YoutubeMetadata } from "./types.js";

const log = rootLogger.child("adapters.youtube.oauth");

export interface TokenJson {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
}

export function loadTokenFile(path: string): TokenJson | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as TokenJson;
}

export function saveTokenFile(path: string, token: TokenJson): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(token, null, 2), { mode: 0o600 });
  // Never log token contents.
  log.info("youtube.token_saved", { path });
}

export function createOAuth2Client(config: RuntimeConfig["youtube"]) {
  if (!config.clientId || !config.clientSecret) {
    throw new ToonForgeError({
      code: "CONFIG_INVALID",
      message: "YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are required",
      component: "adapters.youtube.oauth",
    });
  }
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

/** Build a live googleapis client when tokens exist; used in production mode. */
export function createGoogleYoutubeClient(config: RuntimeConfig["youtube"]): YoutubeApiClient {
  const auth = createOAuth2Client(config);
  const token = loadTokenFile(config.tokenPath);
  if (!token?.refresh_token && !token?.access_token) {
    throw new ToonForgeError({
      code: "ADAPTER_UNAVAILABLE",
      message: `YouTube token missing at ${config.tokenPath}. Run OAuth setup first.`,
      component: "adapters.youtube.oauth",
    });
  }
  auth.setCredentials(token);
  auth.on("tokens", (tokens) => {
    const prev = loadTokenFile(config.tokenPath) ?? {};
    const merged: TokenJson = {
      ...prev,
      access_token: tokens.access_token ?? prev.access_token,
      refresh_token: tokens.refresh_token ?? prev.refresh_token,
      scope: tokens.scope ?? prev.scope,
      token_type: tokens.token_type ?? prev.token_type,
      expiry_date: tokens.expiry_date ?? prev.expiry_date,
    };
    saveTokenFile(config.tokenPath, merged);
  });

  const youtube = google.youtube({ version: "v3", auth });

  return {
    async uploadVideo({ videoPath, metadata }) {
      const fs = await import("node:fs");
      const res = await youtube.videos.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: metadata.title,
            description: metadata.description,
            tags: metadata.tags,
            categoryId: metadata.categoryId || "22",
            defaultLanguage: metadata.language,
          },
          status: {
            privacyStatus: metadata.privacyStatus,
            publishAt: metadata.scheduledStartTime,
            selfDeclaredMadeForKids: false,
          },
        },
        media: {
          body: fs.createReadStream(videoPath),
        },
      });
      const id = res.data.id;
      if (!id) {
        throw new ToonForgeError({
          code: "UPSTREAM_ERROR",
          message: "YouTube upload returned no video id (reconciliation may be required)",
          component: "adapters.youtube.oauth",
          retryable: false,
        });
      }
      return { youtubeId: id };
    },
    async setThumbnail(youtubeId, thumbnailPath) {
      const fs = await import("node:fs");
      await youtube.thumbnails.set({
        videoId: youtubeId,
        media: { body: fs.createReadStream(thumbnailPath) },
      });
    },
    async updateVideo(youtubeId, metadata) {
      await youtube.videos.update({
        part: ["snippet", "status"],
        requestBody: {
          id: youtubeId,
          snippet: {
            title: metadata.title,
            description: metadata.description,
            tags: metadata.tags,
            categoryId: metadata.categoryId,
          },
          status: {
            privacyStatus: metadata.privacyStatus,
            publishAt: metadata.scheduledStartTime,
          },
        },
      });
    },
    async getVideo(youtubeId) {
      const res = await youtube.videos.list({ part: ["snippet", "status", "statistics"], id: [youtubeId] });
      return (res.data.items?.[0] as Record<string, unknown>) ?? {};
    },
    async getAnalytics(youtubeId) {
      // Analytics requires YouTube Analytics API; return video statistics as a safe baseline.
      return this.getVideo(youtubeId);
    },
    async addToPlaylist(youtubeId, playlistId) {
      await youtube.playlistItems.insert({
        part: ["snippet"],
        requestBody: {
          snippet: {
            playlistId,
            resourceId: { kind: "youtube#video", videoId: youtubeId },
          },
        },
      });
    },
  };
}

export function getAuthUrl(config: RuntimeConfig["youtube"], state?: string): string {
  const auth = createOAuth2Client(config);
  return auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: false,
    state,
    scope: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube.upload",
    ],
  });
}
