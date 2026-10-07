import type { AdapterProbe } from "../types.js";

export type PrivacyStatus = "private" | "unlisted" | "public";

export interface YoutubeMetadata {
  title: string;
  description: string;
  tags?: string[];
  categoryId?: string;
  language?: string;
  privacyStatus: PrivacyStatus;
  scheduledStartTime?: string;
  thumbnailPath?: string;
  playlistId?: string;
  containsSyntheticMedia?: boolean;
}

export interface YoutubeUploadRequest {
  idempotencyKey: string;
  projectId: string;
  videoId: string;
  videoPath: string;
  metadata: YoutubeMetadata;
  workflowState?: string;
  qaStatus?: "PASS" | "FAIL" | "WARN";
  policyStatus?: "PASS" | "FAIL";
  dryRun?: boolean;
  provenance?: PublicationManifest["provenance"];
  /** Full provenance record for live-publish fail-closed checks. */
  fullProvenance?: unknown;
}

export interface YoutubeUploadResult {
  youtubeId?: string;
  status: "published" | "scheduled" | "dry_run" | "reconciliation_required" | "failed" | "stub";
  detail?: string;
  idempotencyKey: string;
}

export interface PublicationManifest {
  projectId: string;
  videoId: string;
  channelId?: string;
  referenceIds: string[];
  characterIds: string[];
  artifacts: {
    videoPath: string;
    audioPath?: string;
    thumbnailPath?: string;
    captionsPath?: string;
  };
  hashes: {
    script?: string;
    video?: string;
    audio?: string;
  };
  qaResult: "PASS" | "FAIL" | "WARN";
  policyResult: "PASS" | "FAIL";
  provenance: {
    originalContent: boolean;
    thirdPartyFootage: boolean;
    licensedAssets: string[];
    notes: string[];
  };
  timestamp: string;
  publishStatus: YoutubeUploadResult["status"];
  youtubeId?: string;
  idempotencyKey: string;
}

export interface YoutubeApiClient {
  uploadVideo(input: {
    videoPath: string;
    metadata: YoutubeMetadata;
  }): Promise<{ youtubeId: string }>;
  setThumbnail(youtubeId: string, thumbnailPath: string): Promise<void>;
  updateVideo(youtubeId: string, metadata: Partial<YoutubeMetadata>): Promise<void>;
  getVideo(youtubeId: string): Promise<Record<string, unknown>>;
  getAnalytics(youtubeId: string): Promise<Record<string, unknown>>;
  addToPlaylist?(youtubeId: string, playlistId: string): Promise<void>;
}

export interface YoutubeAdapter extends AdapterProbe {
  name: "youtube";
  authenticate(): Promise<{ ok: boolean; detail: string }>;
  validate_metadata(metadata: YoutubeMetadata): Promise<{ ok: boolean; errors: string[] }>;
  upload(req: YoutubeUploadRequest): Promise<YoutubeUploadResult>;
  schedule(req: YoutubeUploadRequest): Promise<YoutubeUploadResult>;
  publish(req: YoutubeUploadRequest): Promise<YoutubeUploadResult>;
  update(youtubeId: string, metadata: Partial<YoutubeMetadata>): Promise<void>;
  get_video(youtubeId: string): Promise<Record<string, unknown>>;
  get_analytics(youtubeId: string): Promise<Record<string, unknown>>;
  pause_publishing(): Promise<void>;
  resume_publishing(): Promise<void>;
  getManifest(idempotencyKey: string): Promise<PublicationManifest | null>;
}
