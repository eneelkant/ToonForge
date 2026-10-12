export { identityFromCharacter, MAX_PALETTE, type CharacterArtIdentity } from "./identity.js";
export { poseForShot, poseState, interactionForPose, POSE_NAMES, type PoseName, type PoseState, type Interaction } from "./poses.js";
export { textMouthOpen, frameEnvelope } from "./mouth.js";
export { renderCharacterSvg } from "./svg.js";
export { inspectCharacterArtSvg, type ArtInspection } from "./inspect.js";
export { buildCharacterFrames, characterForShot, type CharacterFrame } from "./frames.js";
export {
  renderCharacterArt,
  narrationMouthEnvelope,
  resolveCharacterArtScript,
  type RenderCharacterArtInput,
  type RenderCharacterArtResult,
} from "./render.js";
