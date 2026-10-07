import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OriginalStory } from "../story/index.js";

export interface AudioProvider {
  name: string;
  synthesize(text: string, voiceId?: string): Promise<Uint8Array>;
}

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
  provenance: { provider: string; generated: true };
}

export async function generateAudioBundle(input: {
  projectDir: string;
  story: OriginalStory;
  provider?: AudioProvider;
}): Promise<AudioBundle> {
  const provider = input.provider ?? new MockAudioProvider();
  const dir = join(input.projectDir, "audio");
  mkdirSync(dir, { recursive: true });
  const voice = await provider.synthesize(input.story.narration);
  const voicePath = join(dir, "voice.bin");
  const musicPath = join(dir, "music.bin");
  const mixPath = join(dir, "mix.bin");
  writeFileSync(voicePath, voice);
  writeFileSync(musicPath, new TextEncoder().encode("MOCK_MUSIC_DUCKED"));
  writeFileSync(mixPath, Buffer.concat([voice, new TextEncoder().encode("|MIX|")]));
  return {
    voicePath,
    musicPath,
    mixPath,
    provider: provider.name,
    provenance: { provider: provider.name, generated: true },
  };
}
