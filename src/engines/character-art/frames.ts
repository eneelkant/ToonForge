import type { CharacterRecord } from "../../characters/types.js";
import { ToonForgeError } from "../../core/errors.js";
import type { Storyboard, StoryboardShot } from "../storyboard/index.js";
import { identityFromCharacter, type CharacterArtIdentity } from "./identity.js";
import { poseForShot, poseState, shotAtTime, type PoseName } from "./poses.js";
import { renderCharacterSvg } from "./svg.js";

export interface CharacterFrame {
  index: number;
  timeSec: number;
  pose: PoseName;
  characterId: string;
  svg: string;
}

export function characterForShot(characters: CharacterRecord[], shot: StoryboardShot): CharacterRecord {
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
  return resolved[0]!;
}

export function buildCharacterFrames(input: {
  characters: CharacterRecord[];
  storyboard: Storyboard;
  durationSec: number;
  fps: number;
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
  const identities = new Map<string, CharacterArtIdentity>();
  const frames: CharacterFrame[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const timeSec = index / fps;
    const { shot, index: shotIndex } = shotAtTime(input.storyboard.shots, timeSec);
    const record = characterForShot(input.characters, shot);
    let identity = identities.get(record.character_id);
    if (!identity) {
      identity = identityFromCharacter(record);
      identities.set(record.character_id, identity);
    }
    const poseName = poseForShot(shot, shotIndex);
    const pose = poseState(poseName, index, fps);
    frames.push({
      index,
      timeSec,
      pose: pose.name,
      characterId: identity.id,
      svg: renderCharacterSvg(identity, pose),
    });
  }
  return frames;
}
