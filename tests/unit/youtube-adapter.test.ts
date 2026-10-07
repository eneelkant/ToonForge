import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createYoutubeAdapter } from "../../src/adapters/youtube/index.js";
import type { YoutubeApiClient } from "../../src/adapters/youtube/types.js";
import {
  generateDevThumbnail,
  generateDevVideo,
  writeMediaSidecar,
} from "../../src/core/media.js";

async function tmpMedia(): Promise<{ dir: string; videoPath: string; thumbPath: string }> {
  const dir = mkdtempSync(join(tmpdir(), "tf-yt-"));
  const videoPath = join(dir, "out.mp4");
  const thumbPath = join(dir, "thumb.jpg");
  await generateDevVideo({ outPath: videoPath, durationSec: 1, withAudio: true });
  await generateDevThumbnail({ outPath: thumbPath });
  writeMediaSidecar(videoPath, { kind: "ffmpeg_dev" });
  writeMediaSidecar(thumbPath, { kind: "ffmpeg_dev" });
  return { dir, videoPath, thumbPath };
}

describe("youtube adapter", () => {
  const config = {
    clientId: "id",
    clientSecret: "secret",
    redirectUri: "http://127.0.0.1",
    tokenPath: "./data/youtube-token.json",
    defaultPrivacy: "private" as const,
    dryRunDefault: true,
  };

  it("validates metadata", async () => {
    const yt = createYoutubeAdapter(config, { dataDir: mkdtempSync(join(tmpdir(), "tf-data-")) });
    const bad = await yt.validate_metadata({
      title: "",
      description: "",
      privacyStatus: "private",
    });
    expect(bad.ok).toBe(false);
  });

  it("dry-runs publish and is idempotent", async () => {
    const { dir, videoPath, thumbPath } = await tmpMedia();
    const dataDir = mkdtempSync(join(tmpdir(), "tf-data-"));
    const yt = createYoutubeAdapter(config, { dataDir, dryRunDefault: true });
    const req = {
      idempotencyKey: "pub:p1:v1",
      projectId: "p1",
      videoId: "v1",
      videoPath,
      workflowState: "READY_TO_PUBLISH",
      qaStatus: "PASS" as const,
      policyStatus: "PASS" as const,
      metadata: {
        title: "Original Max Adventure",
        description: "Original cartoon",
        privacyStatus: "private" as const,
        thumbnailPath: thumbPath,
      },
      provenance: {
        originalContent: true,
        thirdPartyFootage: false,
        licensedAssets: [],
        notes: [],
      },
    };
    const first = await yt.publish(req);
    expect(first.status).toBe("dry_run");
    const second = await yt.publish(req);
    expect(second.status).toBe("dry_run");
    expect(second.detail).toMatch(/Idempotent/);
    const manifest = await yt.getManifest("pub:p1:v1");
    expect(manifest?.projectId).toBe("p1");
    expect(dir).toBeTruthy();
  }, 60_000);

  it("blocks FAIL QA and third-party footage", async () => {
    const { videoPath } = await tmpMedia();
    const dataDir = mkdtempSync(join(tmpdir(), "tf-data-"));
    const yt = createYoutubeAdapter(config, { dataDir });
    await expect(
      yt.publish({
        idempotencyKey: "pub:p2:v2",
        projectId: "p2",
        videoId: "v2",
        videoPath,
        workflowState: "READY_TO_PUBLISH",
        qaStatus: "FAIL",
        metadata: { title: "t", description: "d", privacyStatus: "private" },
      }),
    ).rejects.toMatchObject({ code: "QA_BLOCK" });

    await expect(
      yt.publish({
        idempotencyKey: "pub:p3:v3",
        projectId: "p3",
        videoId: "v3",
        videoPath,
        workflowState: "READY_TO_PUBLISH",
        qaStatus: "PASS",
        metadata: { title: "t", description: "d", privacyStatus: "private" },
        provenance: {
          originalContent: true,
          thirdPartyFootage: true,
          licensedAssets: [],
          notes: [],
        },
      }),
    ).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
  }, 60_000);

  it("uploads via injected API client when dryRun=false with production media", async () => {
    const { videoPath, thumbPath } = await tmpMedia();
    writeMediaSidecar(videoPath, { kind: "reelmimic", provider: "reelmimic" });
    writeMediaSidecar(thumbPath, { kind: "provider", provider: "brand" });
    const dataDir = mkdtempSync(join(tmpdir(), "tf-data-"));
    const api: YoutubeApiClient = {
      uploadVideo: vi.fn(async () => ({ youtubeId: "yt_123" })),
      setThumbnail: vi.fn(async () => undefined),
      updateVideo: vi.fn(async () => undefined),
      getVideo: vi.fn(async () => ({ id: "yt_123" })),
      getAnalytics: vi.fn(async () => ({ views: 1 })),
      addToPlaylist: vi.fn(async () => undefined),
    };
    const yt = createYoutubeAdapter(config, { dataDir, apiClient: api, dryRunDefault: false });
    const result = await yt.publish({
      idempotencyKey: "pub:p4:v4",
      projectId: "p4",
      videoId: "v4",
      videoPath,
      dryRun: false,
      workflowState: "READY_TO_PUBLISH",
      qaStatus: "PASS",
      policyStatus: "PASS",
      metadata: {
        title: "Live",
        description: "Desc",
        privacyStatus: "private",
        thumbnailPath: thumbPath,
        playlistId: "pl1",
      },
      provenance: {
        originalContent: true,
        thirdPartyFootage: false,
        licensedAssets: [],
        notes: [],
      },
    });
    expect(result.status).toBe("published");
    expect(result.youtubeId).toBe("yt_123");
    expect(api.uploadVideo).toHaveBeenCalledOnce();
    expect(api.setThumbnail).toHaveBeenCalledOnce();
    expect(api.addToPlaylist).toHaveBeenCalledOnce();
  }, 60_000);

  it("refuses live publish of ffmpeg_dev fixtures", async () => {
    const { videoPath, thumbPath } = await tmpMedia();
    const dataDir = mkdtempSync(join(tmpdir(), "tf-data-"));
    const yt = createYoutubeAdapter(config, { dataDir, dryRunDefault: false });
    await expect(
      yt.publish({
        idempotencyKey: "pub:p6:v6",
        projectId: "p6",
        videoId: "v6",
        videoPath,
        dryRun: false,
        workflowState: "READY_TO_PUBLISH",
        qaStatus: "PASS",
        policyStatus: "PASS",
        metadata: {
          title: "Dev",
          description: "Desc",
          privacyStatus: "private",
          thumbnailPath: thumbPath,
        },
        provenance: {
          originalContent: true,
          thirdPartyFootage: false,
          licensedAssets: [],
          notes: [],
        },
      }),
    ).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
  }, 60_000);

  it("pause blocks publishing", async () => {
    const { videoPath } = await tmpMedia();
    const dataDir = mkdtempSync(join(tmpdir(), "tf-data-"));
    const yt = createYoutubeAdapter(config, { dataDir });
    await yt.pause_publishing();
    await expect(
      yt.publish({
        idempotencyKey: "pub:p5:v5",
        projectId: "p5",
        videoId: "v5",
        videoPath,
        workflowState: "READY_TO_PUBLISH",
        metadata: { title: "t", description: "d", privacyStatus: "private" },
      }),
    ).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
  }, 60_000);
});
