import type { CharacterRecord } from "../../characters/types.js";
import type { Storyboard } from "../../engines/storyboard/index.js";
import type { AdapterProbe } from "../types.js";
import type { OpenMontageErrorClass } from "./errors.js";

export type OpenMontageHealthStatus =
  | "disabled"
  | "ready"
  | "not_installed"
  | "missing_dependencies"
  | "invalid_configuration"
  | "health_check_failed";

export interface OpenMontageHealth {
  status: OpenMontageHealthStatus;
  detail: string;
  root?: string;
  python?: string;
  versions?: Record<string, string>;
}

export interface OpenMontageCharacterSpec {
  id: string;
  display_name: string;
  role: string;
  body_type: string;
  style: string;
  silhouette_notes: string;
  required_emotions: string[];
  required_actions: string[];
  required_views: string[];
  props: string[];
  constraints: string[];
}

export interface CharacterMapping {
  characters: OpenMontageCharacterSpec[];
  /** Identity fields the upstream schema cannot store. Kept on the ToonForge record. */
  preservedLocally: Array<{ id: string; fields: string[] }>;
  derivedFields: string[];
}

export interface OpenMontageScene {
  id: string;
  start_seconds: number;
  end_seconds: number;
  description: string;
  framing: string;
  characters: string[];
}

export interface OpenMontageScenePlan {
  version: "1.0";
  scenes: OpenMontageScene[];
  timelineDurationSec: number;
}

export interface RenderCharacterAnimationInput {
  workspace: string;
  characters: CharacterRecord[];
  storyboard: Storyboard;
  brief: string;
  visualStyle?: string;
  /** Bounded MP4 length passed to character_rig_renderer. The scene plan keeps full timing. */
  durationSeconds: number;
  fps?: number;
}

export interface RenderCharacterAnimationResult {
  videoPath: string;
  artifactPaths: string[];
  versions: Record<string, string>;
  characterIds: string[];
  displayNames: string[];
  durationMs: number;
  retryCount: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  approval: { agentPipeline: "not_invoked"; detail: string };
  previewPath?: string;
}

export interface ProcessRunRequest {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  input: string;
}

export interface ProcessRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export type ProcessRunner = (request: ProcessRunRequest) => Promise<ProcessRunResult>;

export interface RunnerResponse {
  ok: boolean;
  error_class?: OpenMontageErrorClass;
  message?: string;
  versions?: Record<string, string>;
  video_path?: string;
  preview_path?: string;
  character_ids?: string[];
  display_names?: string[];
  artifacts?: string[];
  cost_usd?: number;
  approval?: { agent_pipeline?: string; detail?: string };
  root?: string;
}

export interface OpenMontageAdapter extends AdapterProbe {
  name: "openmontage";
  health(): Promise<OpenMontageHealth>;
  renderCharacterAnimation(input: RenderCharacterAnimationInput): Promise<RenderCharacterAnimationResult>;
}
