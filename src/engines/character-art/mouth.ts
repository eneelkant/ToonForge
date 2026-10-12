/**
 * Mouth timing for Max.
 *
 * Piper's CLI (`python -m piper`) can change phoneme length, but it does not
 * emit phoneme timestamps. This module therefore does not claim phoneme lip-sync.
 *
 * Two deterministic approximations are used:
 * - `textMouthOpen` pulses from the narration letters when no voice file exists yet.
 * - `frameEnvelope` opens the mouth from the fitted narration waveform's amplitude.
 *   The production render uses that envelope after Piper and the tempo fit, so the
 *   mouth tracks the audio that is actually muxed.
 */

export function textMouthOpen(narration: string, localTimeSec: number): number {
  const letters = narration.replace(/[^a-z]/gi, "").length;
  const pulsesPerSec = Math.max(6, Math.min(14, letters / 8));
  const phase = localTimeSec * pulsesPerSec * Math.PI;
  const syllable = Math.max(0, Math.sin(phase));
  return roundMouth(0.12 + 0.72 * Math.pow(syllable, 0.65));
}

export function frameEnvelope(
  samples: ArrayLike<number>,
  sampleRate: number,
  frameCount: number,
  fps: number,
): number[] {
  if (!(sampleRate > 0) || !(fps > 0) || frameCount < 1) {
    throw new Error("frameEnvelope requires a positive sample rate, fps, and frame count");
  }
  const window = Math.max(1, Math.round(sampleRate * 0.04));
  const rms: number[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const center = Math.round((frame / fps) * sampleRate);
    let energy = 0;
    let count = 0;
    const start = Math.max(0, center - window);
    const end = Math.min(samples.length, center + window);
    for (let index = start; index < end; index += 1) {
      const value = samples[index] ?? 0;
      energy += value * value;
      count += 1;
    }
    rms.push(count > 0 ? Math.sqrt(energy / count) : 0);
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.15)] ?? 0;
  const peak = sorted[sorted.length - 1] ?? 0;
  const span = Math.max(1e-6, peak - floor);
  return rms.map((value) => roundMouth(clamp((value - floor) / span, 0, 1)));
}

function roundMouth(value: number): number {
  return Math.round(clamp(value, 0, 1) * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
