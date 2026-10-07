import { randomUUID } from "node:crypto";

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type WorkflowId = Brand<string, "WorkflowId">;
export type ProjectId = Brand<string, "ProjectId">;
export type VideoId = Brand<string, "VideoId">;
export type CharacterId = Brand<string, "CharacterId">;
export type TrendId = Brand<string, "TrendId">;
export type StoryId = Brand<string, "StoryId">;
export type AgentRunId = Brand<string, "AgentRunId">;
export type IdempotencyKey = Brand<string, "IdempotencyKey">;

export function newId<T extends string>(prefix?: string): Brand<string, T> {
  const id = prefix ? `${prefix}_${randomUUID()}` : randomUUID();
  return id as Brand<string, T>;
}

export function publishIdempotencyKey(projectId: string, videoId: string): IdempotencyKey {
  return `pub:${projectId}:${videoId}` as IdempotencyKey;
}
