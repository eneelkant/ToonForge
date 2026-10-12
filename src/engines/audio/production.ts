import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { OriginalStory } from "../story/index.js";
import { validateAudio, writeMediaSidecar, type MediaKind } from "../../core/media.js";
import { ToonForgeError } from "../../core/errors.js";

const execFileAsync = promisify(execFile);

/** Licenses that allow a YouTube upload when the required credit is kept. Share-alike and non-commercial terms are rejected. */
const YOUTUBE_SAFE_LICENSES = new Set(["cc0-1.0", "public-domain", "cc-by-4.0", "cc-by-3.0"]);

/** Matches the long-form storyboard guard. Preview audio is not routed through this function. */
export const PRODUCTION_AUDIO_MAX_SEC = 600;

export const PRODUCTION_AUDIO_SETUP = [
  "Production narration and music are not configured.",
  "offline_fixture may keep ffmpeg_dev tones. openmontage and reelmimic may not.",
  "Narration: install Piper (MIT) in its own environment and a voice whose dataset license is YouTube-safe.",
  "The Lessac Blizzard voice is a research license and is not accepted.",
  "A public-domain option is the Piper ljspeech voice (LJ Speech dataset).",
  "TOONFORGE_TTS_PROVIDER=piper",
  "TOONFORGE_PIPER_PYTHON=/absolute/path/to/python",
  "TOONFORGE_PIPER_MODEL=/absolute/path/to/voice.onnx",
  "TOONFORGE_TTS_LICENSE=public-domain|cc0-1.0|cc-by-4.0|cc-by-3.0",
  "TOONFORGE_TTS_ATTRIBUTION=credit line for the voice dataset and Piper",
  "TOONFORGE_TTS_SOURCE_URL=https://...",
  "Music: a local file you have already checked. Do not point this at a development tone.",
  "TOONFORGE_MUSIC_FILE=/absolute/path/to/track",
  "TOONFORGE_MUSIC_LICENSE=public-domain|cc0-1.0|cc-by-4.0|cc-by-3.0",
  "TOONFORGE_MUSIC_TITLE=track title",
  "TOONFORGE_MUSIC_ATTRIBUTION=required for cc-by",
  "TOONFORGE_MUSIC_SOURCE_URL=https://...",
].join("\n");

export interface LicensedAsset {
  asset: string;
  license: string;
  title: string;
  attribution: string;
  sourceUrl: string;
}

export interface ProductionAudioConfig {
  piperPython: string;
  piperModel: string;
  ttsLicense: string;
  ttsAttribution: string;
  ttsSourceUrl: string;
  musicFile: string;
  musicLicense: string;
  musicTitle: string;
  musicAttribution: string;
  musicSourceUrl: string;
}

export interface ProductionAudioRequest {
  projectDir: string;
  story: OriginalStory;
  targetDurationSec: number;
  config?: ProductionAudioConfig;
  env?: NodeJS.ProcessEnv;
  /** Test seam. The default speaks with Piper. */
  synthesizeWav?: (text: string, wavPath: string, config: ProductionAudioConfig) => Promise<void>;
}

export function normalizeLicense(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/creative commons/g, "")
    .replace(/\s+/g, " ")
    .replace("cc by ", "cc-by-")
    .replace("cc-by ", "cc-by-")
    .replace(/\s/g, "");
}

export function resolveProductionAudioConfig(env: NodeJS.ProcessEnv = process.env): ProductionAudioConfig {
  const provider = (env.TOONFORGE_TTS_PROVIDER ?? "").trim().toLowerCase();
  const missing: string[] = [];
  if (provider !== "piper") missing.push("TOONFORGE_TTS_PROVIDER=piper");
  const piperPython = env.TOONFORGE_PIPER_PYTHON?.trim() ?? "";
  const piperModel = env.TOONFORGE_PIPER_MODEL?.trim() ?? "";
  const musicFile = env.TOONFORGE_MUSIC_FILE?.trim() ?? "";
  const ttsLicense = normalizeLicense(env.TOONFORGE_TTS_LICENSE);
  const musicLicense = normalizeLicense(env.TOONFORGE_MUSIC_LICENSE);
  if (!piperPython || !isAbsolute(piperPython)) missing.push("TOONFORGE_PIPER_PYTHON absolute path");
  if (!piperModel || !isAbsolute(piperModel)) missing.push("TOONFORGE_PIPER_MODEL absolute path");
  if (!musicFile || !isAbsolute(musicFile)) missing.push("TOONFORGE_MUSIC_FILE absolute path");
  if (!YOUTUBE_SAFE_LICENSES.has(ttsLicense)) missing.push("TOONFORGE_TTS_LICENSE (public-domain, cc0-1.0, cc-by-4.0, or cc-by-3.0)");
  if (!YOUTUBE_SAFE_LICENSES.has(musicLicense)) missing.push("TOONFORGE_MUSIC_LICENSE (public-domain, cc0-1.0, cc-by-4.0, or cc-by-3.0)");
  const ttsAttribution = env.TOONFORGE_TTS_ATTRIBUTION?.trim() ?? "";
  const musicAttribution = env.TOONFORGE_MUSIC_ATTRIBUTION?.trim() ?? "";
  const ttsSourceUrl = env.TOONFORGE_TTS_SOURCE_URL?.trim() ?? "";
  const musicSourceUrl = env.TOONFORGE_MUSIC_SOURCE_URL?.trim() ?? "";
  const musicTitle = env.TOONFORGE_MUSIC_TITLE?.trim() ?? "";
  if (!ttsAttribution) missing.push("TOONFORGE_TTS_ATTRIBUTION");
  if (!musicTitle) missing.push("TOONFORGE_MUSIC_TITLE");
  if (musicLicense.startsWith("cc-by") && !musicAttribution) missing.push("TOONFORGE_MUSIC_ATTRIBUTION");
  if (!isHttpUrl(ttsSourceUrl)) missing.push("TOONFORGE_TTS_SOURCE_URL https URL");
  if (!isHttpUrl(musicSourceUrl)) missing.push("TOONFORGE_MUSIC_SOURCE_URL https URL");
  if (missing.length) {
    throw audioError(`${PRODUCTION_AUDIO_SETUP}\n\nMissing or rejected: ${missing.join("; ")}`);
  }
  if (!existsSync(piperPython)) throw audioError(`Piper Python was not found at ${piperPython}\n\n${PRODUCTION_AUDIO_SETUP}`);
  if (!existsSync(piperModel)) throw audioError(`Piper voice model was not found at ${piperModel}\n\n${PRODUCTION_AUDIO_SETUP}`);
  if (!existsSync(musicFile) || statSync(musicFile).size < 1000) {
    throw audioError(`Licensed music file is missing or too small: ${musicFile}\n\n${PRODUCTION_AUDIO_SETUP}`);
  }
  return {
    piperPython,
    piperModel,
    ttsLicense,
    ttsAttribution,
    ttsSourceUrl,
    musicFile,
    musicLicense,
    musicTitle,
    musicAttribution: musicAttribution || "No attribution required for this license.",
    musicSourceUrl,
  };
}

export async function generateProductionAudio(input: ProductionAudioRequest): Promise<{
  voicePath: string;
  musicPath: string;
  mixPath: string;
  provider: string;
  kind: MediaKind;
  stub: false;
  narrationSha256: string;
  credits: string;
  licenses: LicensedAsset[];
  levels: { voiceMeanDb: number; musicMeanDb: number; mixMaxDb: number };
  /** Channel count of the mix. Stereo is used only when the music file itself is stereo. */
  mixChannels: number;
  spokenDurationSec: number;
  tempo: number;
}> {
  const config = input.config ?? resolveProductionAudioConfig(input.env);
  const narration = input.story.narration?.trim() ?? "";
  if (narration.length < 8) {
    throw audioError("Production narration requires the original story narration text.");
  }
  const target = input.targetDurationSec;
  if (!(target >= 1 && target <= PRODUCTION_AUDIO_MAX_SEC)) {
    throw audioError(`Production audio target duration ${target}s is outside 1–${PRODUCTION_AUDIO_MAX_SEC} seconds.`);
  }
  const dir = resolve(input.projectDir, "audio");
  mkdirSync(dir, { recursive: true });
  const narrationSha256 = createHash("sha256").update(narration).digest("hex");
  const rawWav = resolve(dir, "voice-raw.wav");
  const voicePath = resolve(dir, "voice.m4a");
  const musicPath = resolve(dir, "music.m4a");
  const mixPath = resolve(dir, "mix.m4a");
  writeFileSync(resolve(dir, "narration.txt"), `${narration}\n`);

  try {
    await (input.synthesizeWav ?? synthesizeWithPiper)(narration, rawWav, config);
  } catch (error) {
    if (error instanceof ToonForgeError) throw error;
    throw audioError(`Piper narration failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const spoken = await probeDuration(rawWav);
  if (!(spoken > 0.4)) throw audioError("Piper produced no usable narration audio.");
  if (spoken > target * 1.12) {
    throw audioError(
      `Narration is ${spoken.toFixed(2)}s and the video is ${target.toFixed(2)}s. The script was not time-compressed enough to stay intelligible. Shorten the narration or lengthen the storyboard.`,
    );
  }
  const tempo = spoken > target ? Math.min(1.12, spoken / target) : 1;
  await runFfmpeg([
    "-i",
    rawWav,
    "-af",
    `atempo=${tempo.toFixed(4)},apad,loudnorm=I=-16:TP=-1.5:LRA=11`,
    "-t",
    target.toFixed(3),
    "-ar",
    "48000",
    "-c:a",
    "aac",
    voicePath,
  ]);
  await runFfmpeg([
    "-stream_loop",
    "-1",
    "-i",
    config.musicFile,
    "-af",
    `loudnorm=I=-30:TP=-2:LRA=11,afade=t=out:st=${Math.max(0, target - 2).toFixed(3)}:d=${Math.min(2, target).toFixed(3)}`,
    "-t",
    target.toFixed(3),
    "-ar",
    "48000",
    "-c:a",
    "aac",
    musicPath,
  ]);
  const musicChannels = await probeChannels(musicPath);
  const stereo = musicChannels >= 2;
  // A mono voice is centered into a stereo music bed. A mono music file stays mono.
  // Duplicating a mono mix into two identical channels is not treated as stereo.
  const mixFilter = stereo
    ? "[0:a]aformat=channel_layouts=mono,pan=stereo|c0=c0|c1=c0,volume=1[v];[1:a]aformat=channel_layouts=stereo,volume=0.9[m];[v][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]"
    : "[0:a]aformat=channel_layouts=mono,volume=1[v];[1:a]aformat=channel_layouts=mono,volume=0.9[m];[v][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]";
  await runFfmpeg([
    "-i",
    voicePath,
    "-i",
    musicPath,
    "-filter_complex",
    mixFilter,
    "-map",
    "[a]",
    "-ar",
    "48000",
    "-c:a",
    "aac",
    mixPath,
  ]);
  const mixChannels = await probeChannels(mixPath);
  if (mixChannels !== (stereo ? 2 : 1)) {
    throw audioError(
      `Mix channel count ${mixChannels} does not match the music file (${musicChannels} channel${musicChannels === 1 ? "" : "s"}).`,
    );
  }

  const voiceLevel = await measureVolume(voicePath);
  const musicLevel = await measureVolume(musicPath);
  const mixLevel = await measureVolume(mixPath);
  if (mixLevel.maxDb >= -0.1) {
    throw audioError(`Mixed audio is clipping (max ${mixLevel.maxDb.toFixed(2)} dB).`);
  }
  if (!(musicLevel.meanDb <= voiceLevel.meanDb - 8)) {
    throw audioError(
      `Music mean ${musicLevel.meanDb.toFixed(1)} dB is not at least 8 dB below narration ${voiceLevel.meanDb.toFixed(1)} dB.`,
    );
  }
  for (const file of [voicePath, musicPath, mixPath]) {
    const validation = await validateAudio(file, { minDurationSec: Math.max(0.5, target - 0.25), kindHint: "provider" });
    if (!validation.ok) {
      throw audioError(`Production audio failed validation (${file}): ${validation.errors.join("; ")}`);
    }
    const rate = await probeSampleRate(file);
    if (rate !== 48000) throw audioError(`Expected 48000 Hz audio, got ${rate} for ${file}`);
  }

  const licenses: LicensedAsset[] = [
    {
      asset: "narration-voice",
      license: config.ttsLicense,
      title: "Piper narration voice",
      attribution: config.ttsAttribution,
      sourceUrl: config.ttsSourceUrl,
    },
    {
      asset: "background-music",
      license: config.musicLicense,
      title: config.musicTitle,
      attribution: config.musicAttribution,
      sourceUrl: config.musicSourceUrl,
    },
  ];
  const credits = licenses.map((item) => `${item.title}. License: ${item.license}. ${item.attribution} ${item.sourceUrl}`).join("\n");
  const notes = [
    "kind=provider",
    `narration_sha256=${narrationSha256}`,
    "script is the ToonForge story narration, not a reference transcript",
    `mix_channels=${mixChannels}`,
    stereo ? "stereo mix from the licensed music file; narration is centered" : "mono mix because the licensed music file is mono",
    ...licenses.map((item) => `${item.asset}=${item.license}`),
  ];
  for (const file of [voicePath, musicPath, mixPath]) {
    writeMediaSidecar(file, { kind: "provider", provider: "piper+licensed-music", notes });
  }
  writeFileSync(
    resolve(dir, "audio.json"),
    JSON.stringify(
      {
        provider: "piper+licensed-music",
        kind: "provider",
        narration,
        narrationSha256,
        targetDurationSec: target,
        spokenDurationSec: spoken,
        tempo,
        mixChannels,
        levels: { voiceMeanDb: voiceLevel.meanDb, musicMeanDb: musicLevel.meanDb, mixMaxDb: mixLevel.maxDb },
        licenses,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  return {
    voicePath,
    musicPath,
    mixPath,
    provider: "piper+licensed-music",
    kind: "provider",
    stub: false,
    narrationSha256,
    credits,
    licenses,
    levels: { voiceMeanDb: voiceLevel.meanDb, musicMeanDb: musicLevel.meanDb, mixMaxDb: mixLevel.maxDb },
    mixChannels,
    spokenDurationSec: spoken,
    tempo,
  };
}

async function synthesizeWithPiper(text: string, wavPath: string, config: ProductionAudioConfig): Promise<void> {
  const configPath = `${config.piperModel}.json`;
  const args = ["-m", "piper", "--model", config.piperModel, "--output_file", wavPath];
  if (existsSync(configPath)) args.push("--config", configPath);
  const stderr: Buffer[] = [];
  const code = await new Promise<number>((resolvePromise, reject) => {
    const child = spawn(config.piperPython, args, { stdio: ["pipe", "ignore", "pipe"] });
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => resolvePromise(status ?? 1));
    child.stdin?.end(text);
  });
  if (code !== 0 || !existsSync(wavPath) || statSync(wavPath).size < 44) {
    const detail = Buffer.concat(stderr).toString("utf8").replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]").slice(0, 500);
    throw audioError(`Piper exited ${code}. ${detail}`);
  }
}

async function probeDuration(path: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    path,
  ], { encoding: "utf8" });
  return Number(stdout.trim());
}

async function probeChannels(path: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=channels",
    "-of",
    "default=nw=1:nk=1",
    path,
  ], { encoding: "utf8" });
  const channels = Number(stdout.trim());
  if (!Number.isFinite(channels) || channels < 1) {
    throw audioError(`Could not read the channel count for ${path}`);
  }
  return channels;
}

async function probeSampleRate(path: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=sample_rate",
    "-of",
    "default=nw=1:nk=1",
    path,
  ], { encoding: "utf8" });
  return Number(stdout.trim());
}

async function measureVolume(path: string): Promise<{ meanDb: number; maxDb: number }> {
  const { stderr } = await execFileAsync(
    "ffmpeg",
    ["-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const mean = Number(stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/)?.[1]);
  const max = Number(stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/)?.[1]);
  if (!Number.isFinite(mean) || !Number.isFinite(max)) {
    throw audioError(`Could not measure loudness for ${path}`);
  }
  return { meanDb: mean, maxDb: max };
}

async function runFfmpeg(args: string[], timeoutMs = 900_000): Promise<void> {
  await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { timeout: timeoutMs });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function audioError(message: string): ToonForgeError {
  return new ToonForgeError({
    code: "CONFIG_INVALID",
    message,
    component: "engines.audio",
  });
}

export function productionAudioConfigured(env: NodeJS.ProcessEnv = process.env): { ok: boolean; detail: string } {
  try {
    const config = resolveProductionAudioConfig(env);
    return { ok: true, detail: `piper model ${config.piperModel}; music ${config.musicTitle} (${config.musicLicense})` };
  } catch (error) {
    const detail = error instanceof Error ? (error.message.split("\n")[0] ?? error.message) : String(error);
    return { ok: false, detail };
  }
}

export function readNarrationRecord(projectDir: string): { narration: string; narrationSha256: string } {
  const raw = readFileSync(resolve(projectDir, "audio", "audio.json"), "utf8");
  return JSON.parse(raw) as { narration: string; narrationSha256: string };
}
