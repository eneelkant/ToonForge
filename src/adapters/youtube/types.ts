import type { AdapterProbe } from "../types.js";

export interface YoutubeMetadata {
  title: string;
  description: string;
  tags?: string[];
  categoryId?: string;
  language?: string;
  privacyStatus: "private" | "unlisted" | "public";
  scheduledStartTime?: string;
  thumbnailPath?: string;
  playlistId?: string;
  containsSyntheticMedia?: boolean;
}

export interface YoutubeUploadRequest {
  idempotencyKey: string;
  videoPath: string;
  metadata: YoutubeMetadata;
}

export interface YoutubeUploadResult {
  youtubeId?: string;
  status: "published" | "scheduled" | "reconciliation_required" | "failed" | "stub";
  detail?: string;
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
}
