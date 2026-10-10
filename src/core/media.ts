import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ToonForgeError } from "./errors.js";

const execFileAsync = promisify(execFile);

/** Artifact provenance kinds — never conflate invalid stubs with real media. */
export type MediaKind = "reelmimic" | "openmontage" | "ffmpeg_dev" | "provider" | "invalid_stub" | "unknown";

export interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
}

export interface ProbeResult {
  format?: {
    format_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
  };
  streams?: ProbeStream[];
}

export interface VideoValidation {
  ok: boolean;
  kind: MediaKind;
  path: string;
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  errors: string[];
}

export interface AudioValidation {
  ok: boolean;
  kind: MediaKind;
  path: string;
  durationSec?: number;
  codec?: string;
  errors: string[];
}

export interface ImageValidation {
  ok: boolean;
  kind: MediaKind;
  path: string;
  width?: number;
  height?: number;
  format?: string;
  sizeBytes: number;
  errors: string[];
}

function parseFps(rate?: string): number | undefined {
  if (!rate || rate === "0/0") return undefined;
  const parts = rate.split("/").map(Number);
  const a = parts[0];
  const b = parts[1];
  if (a == null) return undefined;
  if (!b) return Number.isFinite(a) ? a : undefined;
  return a / b;
}

/** Detect text-placeholder "videos" that must never pass as real media. */
export function detectInvalidStub(path: string): boolean {
  if (!existsSync(path)) return false;
  const size = statSync(path).size;
  if (size <= 0) return true;
  if (size > 4096) return false;
  const head = readFileSync(path).subarray(0, Math.min(256, size)).toString("utf8");
  return (
    head.includes("TOONFORGE_LOCAL_RENDER") ||
    head.startsWith("THUMB:") ||
    head.startsWith("MOCK_") ||
    head.includes("fake-mp4") ||
    /^[\x20-\x7E\s]+$/.test(head) && !head.includes("ftyp")
  );
}

export async function ffprobeJson(path: string): Promise<ProbeResult> {
  if (!existsSync(path)) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `ffprobe target missing: ${path}`,
      component: "core.media",
    });
  }
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
      { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
    );
    return JSON.parse(stdout) as ProbeResult;
  } catch (error) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `ffprobe failed for ${path}: ${error instanceof Error ? error.message : String(error)}`,
      component: "core.media",
      cause: error,
    });
  }
}

export async function validateVideo(
  path: string,
  opts: {
    requireAudio?: boolean;
    minDurationSec?: number;
    maxDurationSec?: number;
    expectedWidth?: number;
    expectedHeight?: number;
    kindHint?: MediaKind;
  } = {},
): Promise<VideoValidation> {
  const errors: string[] = [];
  if (!existsSync(path)) {
    return {
      ok: false,
      kind: "invalid_stub",
      path,
      hasVideo: false,
      hasAudio: false,
      errors: ["file missing"],
    };
  }
  const size = statSync(path).size;
  if (size <= 0) {
    return {
      ok: false,
      kind: "invalid_stub",
      path,
      hasVideo: false,
      hasAudio: false,
      errors: ["empty file"],
    };
  }
  if (detectInvalidStub(path)) {
    return {
      ok: false,
      kind: "invalid_stub",
      path,
      hasVideo: false,
      hasAudio: false,
      errors: ["invalid stub / text placeholder — not a real media container"],
    };
  }

  let probe: ProbeResult;
  try {
    probe = await ffprobeJson(path);
  } catch (error) {
    return {
      ok: false,
      kind: "invalid_stub",
      path,
      hasVideo: false,
      hasAudio: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  const streams = probe.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const durationSec = Number(probe.format?.duration ?? v?.duration ?? 0);
  const fps = parseFps(v?.avg_frame_rate);

  if (!v) errors.push("no video stream");
  if (opts.requireAudio && !a) errors.push("no audio stream (required)");
  if (!(durationSec > 0)) errors.push("duration must be > 0");
  if (opts.minDurationSec != null && durationSec < opts.minDurationSec) {
    errors.push(`duration ${durationSec}s < min ${opts.minDurationSec}s`);
  }
  if (opts.maxDurationSec != null && durationSec > opts.maxDurationSec) {
    errors.push(`duration ${durationSec}s > max ${opts.maxDurationSec}s`);
  }
  if (opts.expectedWidth && v?.width && v.width !== opts.expectedWidth) {
    errors.push(`width ${v.width} != expected ${opts.expectedWidth}`);
  }
  if (opts.expectedHeight && v?.height && v.height !== opts.expectedHeight) {
    errors.push(`height ${v.height} != expected ${opts.expectedHeight}`);
  }

  return {
    ok: errors.length === 0,
    kind: opts.kindHint ?? "unknown",
    path,
    durationSec,
    width: v?.width,
    height: v?.height,
    fps,
    hasVideo: Boolean(v),
    hasAudio: Boolean(a),
    errors,
  };
}

export async function validateAudio(
  path: string,
  opts: { minDurationSec?: number; kindHint?: MediaKind } = {},
): Promise<AudioValidation> {
  const errors: string[] = [];
  if (!existsSync(path)) {
    return { ok: false, kind: "invalid_stub", path, errors: ["file missing"] };
  }
  if (statSync(path).size <= 0) {
    return { ok: false, kind: "invalid_stub", path, errors: ["empty file"] };
  }
  if (path.endsWith(".bin") || detectInvalidStub(path)) {
    return {
      ok: false,
      kind: "invalid_stub",
      path,
      errors: ["invalid stub / non-audio artifact"],
    };
  }
  try {
    const probe = await ffprobeJson(path);
    const a = (probe.streams ?? []).find((s) => s.codec_type === "audio");
    const durationSec = Number(probe.format?.duration ?? a?.duration ?? 0);
    if (!a) errors.push("no audio stream");
    if (!(durationSec > 0)) errors.push("duration must be > 0");
    if (opts.minDurationSec != null && durationSec < opts.minDurationSec) {
      errors.push(`duration ${durationSec}s < min ${opts.minDurationSec}s`);
    }
    return {
      ok: errors.length === 0,
      kind: opts.kindHint ?? "unknown",
      path,
      durationSec,
      codec: a?.codec_name,
      errors,
    };
  } catch (error) {
    return {
      ok: false,
      kind: "invalid_stub",
      path,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function validateImage(
  path: string,
  opts: {
    minWidth?: number;
    minHeight?: number;
    maxAspectRatioDelta?: number;
    expectedAspect?: number;
    kindHint?: MediaKind;
  } = {},
): Promise<ImageValidation> {
  const errors: string[] = [];
  if (!existsSync(path)) {
    return { ok: false, kind: "invalid_stub", path, sizeBytes: 0, errors: ["file missing"] };
  }
  const sizeBytes = statSync(path).size;
  if (sizeBytes <= 32) {
    return {
      ok: false,
      kind: "invalid_stub",
      path,
      sizeBytes,
      errors: ["file too small to be a real image"],
    };
  }
  if (detectInvalidStub(path)) {
    return {
      ok: false,
      kind: "invalid_stub",
      path,
      sizeBytes,
      errors: ["placeholder / text thumbnail"],
    };
  }
  try {
    const probe = await ffprobeJson(path);
    const v = (probe.streams ?? []).find((s) => s.codec_type === "video");
    const width = v?.width;
    const height = v?.height;
    if (!width || !height) errors.push("missing image dimensions");
    if (opts.minWidth && width && width < opts.minWidth) errors.push(`width ${width} < ${opts.minWidth}`);
    if (opts.minHeight && height && height < opts.minHeight) {
      errors.push(`height ${height} < ${opts.minHeight}`);
    }
    if (opts.expectedAspect && width && height) {
      const aspect = width / height;
      const delta = Math.abs(aspect - opts.expectedAspect);
      if (delta > (opts.maxAspectRatioDelta ?? 0.15)) {
        errors.push(`aspect ${aspect.toFixed(3)} != expected ${opts.expectedAspect}`);
      }
    }
    return {
      ok: errors.length === 0,
      kind: opts.kindHint ?? "unknown",
      path,
      width,
      height,
      format: probe.format?.format_name,
      sizeBytes,
      errors,
    };
  } catch (error) {
    return {
      ok: false,
      kind: "invalid_stub",
      path,
      sizeBytes,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function runFfmpeg(args: string[], label: string): Promise<void> {
  try {
    await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    throw new ToonForgeError({
      code: "UPSTREAM_ERROR",
      message: `ffmpeg ${label} failed: ${error instanceof Error ? error.message : String(error)}`,
      component: "core.media",
      cause: error,
    });
  }
}

/** Deterministic CI/dev-only short cartoon clip (valid H.264 + AAC MP4). Marked ffmpeg_dev. */
export async function generateDevVideo(opts: {
  outPath: string;
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  withAudio?: boolean;
  label?: string;
}): Promise<{ path: string; kind: "ffmpeg_dev" }> {
  const duration = Math.max(1, opts.durationSec ?? 2);
  const width = opts.width ?? 640;
  const height = opts.height ?? 360;
  const fps = opts.fps ?? 24;
  const withAudio = opts.withAudio ?? true;
  mkdirSync(dirname(opts.outPath), { recursive: true });
  // No drawtext — avoids fontconfig dependency in CI/containers.
  const videoFilter = `color=c=0x1a3a5c:s=${width}x${height}:d=${duration}:r=${fps}`;

  if (withAudio) {
    await runFfmpeg(
      [
        "-f",
        "lavfi",
        "-i",
        videoFilter,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=440:duration=${duration}`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        "-movflags",
        "+faststart",
        opts.outPath,
      ],
      "generateDevVideo",
    );
  } else {
    await runFfmpeg(
      [
        "-f",
        "lavfi",
        "-i",
        videoFilter,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-t",
        String(duration),
        "-movflags",
        "+faststart",
        opts.outPath,
      ],
      "generateDevVideo",
    );
  }
  return { path: opts.outPath, kind: "ffmpeg_dev" };
}

export async function generateDevAudio(opts: {
  outPath: string;
  durationSec?: number;
  frequencyHz?: number;
}): Promise<{ path: string; kind: "ffmpeg_dev" }> {
  const duration = Math.max(0.5, opts.durationSec ?? 2);
  const freq = opts.frequencyHz ?? 440;
  mkdirSync(dirname(opts.outPath), { recursive: true });
  await runFfmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${freq}:duration=${duration}`,
      "-c:a",
      "aac",
      opts.outPath,
    ],
    "generateDevAudio",
  );
  return { path: opts.outPath, kind: "ffmpeg_dev" };
}

export async function mixAudioTracks(opts: {
  voicePath: string;
  musicPath: string;
  outPath: string;
  musicVolume?: number;
}): Promise<string> {
  mkdirSync(dirname(opts.outPath), { recursive: true });
  const vol = opts.musicVolume ?? 0.2;
  await runFfmpeg(
    [
      "-i",
      opts.voicePath,
      "-i",
      opts.musicPath,
      "-filter_complex",
      `[1:a]volume=${vol}[m];[0:a][m]amix=inputs=2:duration=longest:dropout_transition=2[a]`,
      "-map",
      "[a]",
      "-c:a",
      "aac",
      opts.outPath,
    ],
    "mixAudioTracks",
  );
  return opts.outPath;
}

export async function muxVideoAudio(opts: {
  videoPath: string;
  audioPath: string;
  outPath: string;
}): Promise<string> {
  mkdirSync(dirname(opts.outPath), { recursive: true });
  await runFfmpeg(
    [
      "-i",
      opts.videoPath,
      "-i",
      opts.audioPath,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      "-movflags",
      "+faststart",
      opts.outPath,
    ],
    "muxVideoAudio",
  );
  return opts.outPath;
}

export async function generateDevThumbnail(opts: {
  outPath: string;
  width?: number;
  height?: number;
  label?: string;
}): Promise<{ path: string; kind: "ffmpeg_dev" }> {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  mkdirSync(dirname(opts.outPath), { recursive: true });
  // Solid-color JPEG via lavfi — portable, no fonts required.
  await runFfmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      `color=c=0x0d47a1:s=${width}x${height}:d=1`,
      "-frames:v",
      "1",
      opts.outPath,
    ],
    "generateDevThumbnail",
  );
  return { path: opts.outPath, kind: "ffmpeg_dev" };
}

/** True when artifact is allowed for live YouTube upload. */
export function isProductionMediaKind(kind: MediaKind): boolean {
  return kind === "reelmimic" || kind === "openmontage" || kind === "provider";
}

export function sidecarPath(mediaPath: string): string {
  return `${mediaPath}.meta.json`;
}

export function writeMediaSidecar(
  mediaPath: string,
  meta: { kind: MediaKind; provider?: string; notes?: string[]; createdAt?: string },
): void {
  writeFileSync(
    sidecarPath(mediaPath),
    JSON.stringify(
      {
        kind: meta.kind,
        provider: meta.provider ?? null,
        notes: meta.notes ?? [],
        createdAt: meta.createdAt ?? new Date().toISOString(),
        mediaPath,
      },
      null,
      2,
    ),
  );
}

export function readMediaKind(mediaPath: string): MediaKind {
  const side = sidecarPath(mediaPath);
  if (existsSync(side)) {
    try {
      const raw = JSON.parse(readFileSync(side, "utf8")) as { kind?: MediaKind };
      if (raw.kind) return raw.kind;
    } catch {
      /* ignore */
    }
  }
  if (detectInvalidStub(mediaPath)) return "invalid_stub";
  return "unknown";
}

export function projectMediaDir(projectDir: string): string {
  return join(projectDir, "out");
}
