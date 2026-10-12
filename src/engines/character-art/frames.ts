import type { CharacterRecord } from "../../characters/types.js";
import { ToonForgeError } from "../../core/errors.js";
import type { Storyboard, StoryboardShot } from "../storyboard/index.js";
import { identityFromCharacter, type CharacterArtIdentity } from "./identity.js";
import { expressionForShot, poseForShot, poseState, shotAtTime, viewForCamera, type PoseName } from "./poses.js";
import { renderCharacterSvg } from "./svg.js";
import { renderCastSvg } from "./cast.js";

export interface CharacterFrame {
  index: number;
  timeSec: number;
  pose: PoseName;
  characterId: string;
  svg: string;
}

export function charactersForShot(characters: CharacterRecord[], shot: StoryboardShot): CharacterRecord[] {
  const ids =
    shot.characters.length > 0
      ? shot.characters
      : characters.length === 1 && characters[0]
        ? [characters[0].character_id]
        : [];
  if (ids.length === 0) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `Shot ${shot.shot_id} has no configured character.`,
      component: "engines.character-art",
      context: { shotId: shot.shot_id },
    });
  }
  const resolved: CharacterRecord[] = [];
  for (const id of ids) {
    const found = characters.find((character) => character.character_id === id);
    if (!found) {
      throw new ToonForgeError({
        code: "VALIDATION_FAILED",
        message: `Shot ${shot.shot_id} asks for character "${id}", which is not in the configured registry.`,
        component: "engines.character-art",
        context: { shotId: shot.shot_id, characterId: id },
      });
    }
    identityFromCharacter(found);
    resolved.push(found);
  }
  return resolved;
}

export function characterForShot(characters: CharacterRecord[], shot: StoryboardShot): CharacterRecord {
  return charactersForShot(characters, shot)[0]!;
}

export function buildCharacterFrames(input: {
  characters: CharacterRecord[];
  storyboard: Storyboard;
  durationSec: number;
  fps: number;
  /** One openness value per frame, taken from the fitted narration waveform. */
  mouthOpen?: number[];
}): CharacterFrame[] {
  if (input.storyboard.shots.length === 0) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: "Character art requires storyboard shots so poses stay tied to the episode.",
      component: "engines.character-art",
    });
  }
  const fps = Math.max(1, Math.round(input.fps));
  const frameCount = Math.max(1, Math.round(input.durationSec * fps));
  if (input.mouthOpen && input.mouthOpen.length !== frameCount) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: "Narration mouth envelope must provide one openness value per frame.",
      component: "engines.character-art",
      context: { frames: frameCount, envelope: input.mouthOpen.length },
    });
  }
  const identities = new Map<string, CharacterArtIdentity>();
  const frames: CharacterFrame[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const timeSec = index / fps;
    const placed = shotAtTime(input.storyboard.shots, timeSec);
    const records = charactersForShot(input.characters, placed.shot);
    const cast = records.map((record) => {
      let identity = identities.get(record.character_id);
      if (!identity) {
        identity = identityFromCharacter(record);
        identities.set(record.character_id, identity);
      }
      return identity;
    });
    const poseName = poseForShot(placed.shot, placed.index);
    const mouthOpen = input.mouthOpen?.[index];
    const view = viewForCamera(placed.shot.camera);
    const poses = cast.map((_, castIndex) =>
      poseState(poseName, index, fps, {
        localTimeSec: placed.localTimeSec + castIndex * 0.12,
        shotDurationSec: placed.shotDurationSec,
        narration: placed.shot.narration,
        mouthOpen,
        view,
        expression: expressionForShot(placed.shot, poseName),
      }),
    );
    const lead = cast[0]!;
    const pose = poses[0]!;
    const svg =
      cast.length === 1 && lead.kind === "max"
        ? renderCharacterSvg(lead, pose)
        : renderCastSvg({
            identities: cast,
            poses,
            visual: placed.shot.visual,
            onScreenText: placed.shot.on_screen_text,
          });
    frames.push({
      index,
      timeSec,
      pose: pose.name,
      characterId: lead.id,
      svg,
    });
  }
  return frames;
}
