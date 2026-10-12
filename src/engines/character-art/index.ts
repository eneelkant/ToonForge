export { identityFromCharacter, MAX_PALETTE, MILA_PALETTE, MILO_MONKEY_PALETTE, type CharacterArtIdentity } from "./identity.js";
export {
  poseForShot,
  poseState,
  interactionForPose,
  viewForCamera,
  expressionForPose,
  expressionForShot,
  POSE_NAMES,
  EXPRESSION_NAMES,
  VIEW_NAMES,
  type PoseName,
  type PoseState,
  type Interaction,
  type ExpressionName,
  type ViewName,
} from "./poses.js";
export { renderCastSvg, renderTitleCard, backgroundForVisual, renderMila, renderMilo } from "./cast.js";
export { textMouthOpen, frameEnvelope } from "./mouth.js";
export { renderCharacterSvg } from "./svg.js";
export { inspectCharacterArtSvg, type ArtInspection } from "./inspect.js";
export { buildCharacterFrames, characterForShot, type CharacterFrame } from "./frames.js";
export {
  renderCharacterArt,
  rasterizeStill,
  narrationMouthEnvelope,
  resolveCharacterArtScript,
  type RenderCharacterArtInput,
  type RenderCharacterArtResult,
} from "./render.js";
