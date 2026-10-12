import type { PipelineMode } from "../engines/reference/index.js";

const PIPELINES = new Set<PipelineMode>(["offline_fixture", "reelmimic", "openmontage"]);

export interface DailyRunArgs {
  publish: boolean;
  pipelineMode?: PipelineMode;
  channelPath?: string;
}

export function parseDailyRunArgs(args: string[]): DailyRunArgs {
  const publish = args.includes("--publish");
  const pipeline = option(args, "--pipeline");
  const channelPath = option(args, "--channel-config");
  if (pipeline && !PIPELINES.has(pipeline as PipelineMode)) {
    throw new Error("--pipeline must be offline_fixture, reelmimic, or openmontage");
  }
  return {
    publish,
    pipelineMode: pipeline as PipelineMode | undefined,
    channelPath,
  };
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}
