import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OriginalStory } from "../story/index.js";
import {
  generateDevAudio,
  mixAudioTracks,
  validateAudio,
  writeMediaSidecar,
  type MediaKind,
} from "../../core/media.js";
import { ToonForgeError } from "../../core/errors.js";

export interface AudioProvider {
  name: string;
  /** Return raw audio bytes AND a hint for container extension if known. */
  synthesize(text: string, voiceId?: string): Promise<{ bytes: Uint8Array; ext?: string } | Uint8Array>;
}

/**
 * Development TTS: generates a valid AAC tone whose duration scales with narration length.
 * Marked ffmpeg_dev — never for live publish.
 */
export class FfmpegDevAudioProvider implements AudioProvider {
  name = "ffmpeg-dev-tts";
  async synthesize(text: string): Promise<Uint8Array> {
    // Provider interface historically returned bytes; caller uses generateAudioBundle paths.
    // Duration hint encoded as UTF-8 length for tests that still call synthesize directly.
    return new TextEncoder().encode(`DEV_TTS_META:${text.length}`);
  }
}

/** Legacy mock — intentionally invalid; generateAudioBundle must not treat as production. */
export class MockAudioProvider implements AudioProvider {
  name = "mock-tts";
  async synthesize(text: string): Promise<Uint8Array> {
    return new TextEncoder().encode(`MOCK_WAV:${text.slice(0, 120)}`);
  }
}

export interface AudioBundle {
  voicePath: string;
  musicPath: string;
  mixPath: string;
  provider: string;
  kind: MediaKind;
  stub: boolean;
  provenance: { provider: string; generated: true; kind: MediaKind };
}

export async function generateAudioBundle(input: {
  projectDir: string;
  story: OriginalStory;
  provider?: AudioProvider;
  /** Force real FFmpeg tones even when a mock provider is injected. */
  preferValidMedia?: boolean;
}): Promise<AudioBundle> {
  const preferValid = input.preferValidMedia ?? true;
  const provider = input.provider ?? new FfmpegDevAudioProvider();
  const dir = join(input.projectDir, "audio");
  mkdirSync(dir, { recursive: true });

  const narrationLen = input.story.narration?.length ?? 40;
  const durationSec = Math.min(8, Math.max(1.5, narrationLen / 40));

  if (preferValid || provider.name === "ffmpeg-dev-tts") {
    const voicePath = join(dir, "voice.m4a");
    const musicPath = join(dir, "music.m4a");
    const mixPath = join(dir, "mix.m4a");
    await generateDevAudio({ outPath: voicePath, durationSec, frequencyHz: 523 });
    await generateDevAudio({ outPath: musicPath, durationSec, frequencyHz: 220 });
    await mixAudioTracks({
      voicePath,
      musicPath,
      outPath: mixPath,
      musicVolume: 0.18,
    });
    for (const [p, note] of [
      [voicePath, "dev voice tone"],
      [musicPath, "dev music bed"],
      [mixPath, "dev mix"],
    ] as const) {
      const v = await validateAudio(p, { kindHint: "ffmpeg_dev" });
      if (!v.ok) {
        throw new ToonForgeError({
          code: "VALIDATION_FAILED",
          message: `Invalid audio ${p}: ${v.errors.join("; ")}`,
          component: "engines.audio",
        });
      }
      writeMediaSidecar(p, {
        kind: "ffmpeg_dev",
        provider: provider.name,
        notes: [note, "DEV/CI ONLY — not for live publish"],
      });
    }
    writeFileSync(
      join(dir, "audio.json"),
      JSON.stringify(
        {
          provider: provider.name,
          kind: "ffmpeg_dev",
          durationSec,
          narrationPreview: input.story.narration.slice(0, 200),
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
      provider: provider.name,
      kind: "ffmpeg_dev",
      stub: false,
      provenance: { provider: provider.name, generated: true, kind: "ffmpeg_dev" },
    };
  }

  // Explicit mock path — marked invalid_stub
  const raw = await provider.synthesize(input.story.narration);
  const bytes = raw instanceof Uint8Array ? raw : raw.bytes;
  const voicePath = join(dir, "voice.bin");
  const musicPath = join(dir, "music.bin");
  const mixPath = join(dir, "mix.bin");
  writeFileSync(voicePath, bytes);
  writeFileSync(musicPath, new TextEncoder().encode("MOCK_MUSIC_DUCKED"));
  writeFileSync(mixPath, Buffer.concat([Buffer.from(bytes), Buffer.from("|MIX|")]));
  for (const p of [voicePath, musicPath, mixPath]) {
    writeMediaSidecar(p, {
      kind: "invalid_stub",
      provider: provider.name,
      notes: ["Invalid mock bytes — must FAIL production publish"],
    });
  }
  return {
    voicePath,
    musicPath,
    mixPath,
    provider: provider.name,
    kind: "invalid_stub",
    stub: true,
    provenance: { provider: provider.name, generated: true, kind: "invalid_stub" },
  };
}
