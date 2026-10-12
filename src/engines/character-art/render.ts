import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ToonForgeError } from "../../core/errors.js";
import type { CharacterRecord } from "../../characters/types.js";
import type { Storyboard } from "../storyboard/index.js";
import { buildCharacterFrames } from "./frames.js";

export interface CharacterArtRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type CharacterArtRunner = (request: {
  command: string;
  args: string[];
  timeoutMs: number;
  input: string;
}) => Promise<CharacterArtRunResult>;

export interface RenderCharacterArtInput {
  characters: CharacterRecord[];
  storyboard: Storyboard;
  outPath: string;
  stillPath?: string;
  framesDir: string;
  durationSec: number;
  fps?: number;
  python: string;
  scriptPath?: string;
  run?: CharacterArtRunner;
  timeoutMs?: number;
}

export interface RenderCharacterArtResult {
  videoPath: string;
  stillPath?: string;
  frames: number;
  characterIds: string[];
}

export function resolveCharacterArtScript(explicit?: string): string {
  if (explicit) return explicit;
  const candidates = [
    join(process.cwd(), "scripts", "character_art_render.py"),
    join(dirname(fileURLToPath(import.meta.url)), "../../../scripts/character_art_render.py"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

function defaultRunner(): CharacterArtRunner {
  return (request) =>
    new Promise((done, reject) => {
      const child = execFile(
        request.command,
        request.args,
        { timeout: request.timeoutMs, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error && error.code === "ENOENT") {
            reject(
              new ToonForgeError({
                code: "ADAPTER_UNAVAILABLE",
                message: `Character art Python was not found: ${request.command}. Set OPENMONTAGE_PYTHON to the environment that has Playwright.`,
                component: "engines.character-art",
                cause: error,
              }),
            );
            return;
          }
          const timedOut = Boolean(error && "killed" in error && error.killed);
          done({
            code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
            timedOut,
          });
        },
      );
      child.stdin?.end(request.input);
    });
}

function parseResponse(stdout: string): { ok?: boolean; error_class?: string; message?: string; video_path?: string; still_path?: string; frames?: number } {
  const line = stdout
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .reverse()
    .find((item) => item.startsWith("{"));
  if (!line) return {};
  try {
    return JSON.parse(line) as { ok?: boolean; error_class?: string; message?: string; video_path?: string; still_path?: string; frames?: number };
  } catch {
    return {};
  }
}

export async function renderCharacterArt(input: RenderCharacterArtInput): Promise<RenderCharacterArtResult> {
  const fps = input.fps ?? 12;
  const frames = buildCharacterFrames({
    characters: input.characters,
    storyboard: input.storyboard,
    durationSec: input.durationSec,
    fps,
  });
  mkdirSync(input.framesDir, { recursive: true });
  for (const frame of frames) {
    writeFileSync(join(input.framesDir, `frame_${String(frame.index).padStart(5, "0")}.svg`), frame.svg);
  }
  const script = resolveCharacterArtScript(input.scriptPath);
  if (!existsSync(script)) {
    throw new ToonForgeError({
      code: "CONFIG_INVALID",
      message: `Character art renderer script is missing: ${script}`,
      component: "engines.character-art",
    });
  }
  if (!input.python.trim()) {
    throw new ToonForgeError({
      code: "CONFIG_INVALID",
      message: "Character art rendering needs OPENMONTAGE_PYTHON with Playwright and ffmpeg installed. No Python executable was configured.",
      component: "engines.character-art",
    });
  }
  const stillPath = input.stillPath ?? join(dirname(input.outPath), "character-still.png");
  const payload = JSON.stringify({
    frames_dir: input.framesDir,
    video_output_path: input.outPath,
    still_path: stillPath,
    fps,
  });
  const timeoutMs = input.timeoutMs ?? Math.max(120_000, frames.length * 2_000);
  let result: CharacterArtRunResult;
  try {
    result = await (input.run ?? defaultRunner())({
      command: input.python,
      args: [script],
      timeoutMs,
      input: payload,
    });
  } catch (error) {
    if (error instanceof ToonForgeError) throw error;
    throw new ToonForgeError({
      code: "UPSTREAM_ERROR",
      message: error instanceof Error ? error.message : String(error),
      component: "engines.character-art",
      cause: error,
    });
  }
  const parsed = parseResponse(result.stdout);
  if (result.timedOut || result.code !== 0 || parsed.ok !== true) {
    const message =
      parsed.message ||
      result.stderr.trim() ||
      (result.timedOut ? "Character art render timed out" : `Character art renderer exited ${result.code}`);
    const missing = parsed.error_class === "missing_dependencies" || /playwright|ffmpeg/i.test(message);
    throw new ToonForgeError({
      code: missing ? "ADAPTER_UNAVAILABLE" : "UPSTREAM_ERROR",
      message,
      component: "engines.character-art",
      context: { errorClass: parsed.error_class ?? (result.timedOut ? "timeout" : "execution_failure") },
    });
  }
  if (!existsSync(input.outPath)) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: "Character art renderer reported success without a video file",
      component: "engines.character-art",
    });
  }
  return {
    videoPath: input.outPath,
    stillPath: parsed.still_path && existsSync(parsed.still_path) ? parsed.still_path : undefined,
    frames: frames.length,
    characterIds: [...new Set(frames.map((frame) => frame.characterId))],
  };
}
