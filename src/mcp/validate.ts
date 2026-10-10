import { z } from "zod";
import { ToonForgeError } from "../core/errors.js";

const pipelineMode = z.enum(["offline_fixture", "reelmimic", "openmontage"]);

const publishMetadata = z
  .object({
    title: z.string().min(1).max(100),
    description: z.string().min(1),
    privacyStatus: z.enum(["private", "unlisted", "public"]),
    tags: z.array(z.string()).max(30).optional(),
    thumbnailPath: z.string().optional(),
    scheduledStartTime: z.string().optional(),
    categoryId: z.string().optional(),
    language: z.string().optional(),
    playlistId: z.string().optional(),
  })
  .strict();

const schemas: Record<string, z.ZodTypeAny> = {
  "toonforge.system_status": z.object({}).strict(),
  "toonforge.doctor": z.object({}).strict(),
  "toonforge.discover_trends": z.object({ channelPath: z.string().optional(), limit: z.number().int().positive().max(50).optional() }).strict(),
  "toonforge.analyze_reference": z.object({ sourcePath: z.string().optional(), sourceUrl: z.string().optional(), outDir: z.string().optional() }).strict(),
  "toonforge.score_trends": z.object({ trends: z.array(z.record(z.unknown())).max(50).optional() }).strict(),
  "toonforge.list_characters": z.object({}).strict(),
  "toonforge.get_character": z.object({ characterId: z.string().min(1) }).strict(),
  "toonforge.validate_character": z.object({ characterId: z.string().min(1) }).strict(),
  "toonforge.select_characters": z.object({ roles: z.array(z.string()).optional(), preferredIds: z.array(z.string()).optional() }).strict(),
  "toonforge.generate_story": z.object({ channelPath: z.string().optional(), characterIds: z.array(z.string()).optional(), trend: z.unknown().optional() }).strict(),
  "toonforge.validate_story": z.object({ story: z.unknown() }).strict(),
  "toonforge.create_storyboard": z.object({ story: z.unknown() }).strict(),
  "toonforge.generate_cartoon": z.object({
    projectId: z.string().optional(),
    projectDir: z.string().optional(),
    pipelineMode: pipelineMode.optional(),
    story: z.unknown().optional(),
    storyboard: z.unknown().optional(),
    referencePath: z.string().optional(),
    referenceUrl: z.string().optional(),
  }).strict(),
  "toonforge.openmontage_health": z.object({}).strict(),
  "toonforge.production_backends": z.object({}).strict(),
  "toonforge.review_video": z.object({
    videoPath: z.string().optional(),
    audioPath: z.string().optional(),
    captionsPath: z.string().optional(),
    thumbnailPath: z.string().optional(),
    metadata: z.object({ title: z.string().optional(), description: z.string().optional() }).strict().optional(),
    storyComplete: z.boolean().optional(),
    originalContent: z.boolean().optional(),
    thirdPartyFootage: z.boolean().optional(),
    allowDevFixtures: z.boolean().optional(),
  }).strict(),
  "toonforge.generate_voice": z.object({ projectDir: z.string().optional(), story: z.unknown().optional() }).strict(),
  "toonforge.generate_music": z.object({ projectDir: z.string().optional(), story: z.unknown().optional() }).strict(),
  "toonforge.generate_captions": z.object({ projectDir: z.string().optional(), story: z.unknown().optional(), durationSeconds: z.number().optional() }).strict(),
  "toonforge.generate_thumbnail": z.object({ projectDir: z.string().optional(), story: z.unknown().optional(), durationSeconds: z.number().optional() }).strict(),
  "toonforge.generate_metadata": z.object({ projectDir: z.string().optional(), story: z.unknown().optional(), durationSeconds: z.number().optional() }).strict(),
  "toonforge.run_qa": z.object({
    videoPath: z.string().optional(),
    audioPath: z.string().optional(),
    captionsPath: z.string().optional(),
    thumbnailPath: z.string().optional(),
    metadata: z.object({ title: z.string().optional(), description: z.string().optional() }).strict().optional(),
    storyComplete: z.boolean().optional(),
    originalContent: z.boolean().optional(),
    thirdPartyFootage: z.boolean().optional(),
    allowDevFixtures: z.boolean().optional(),
  }).strict(),
  "toonforge.prepare_publish": publishArgs(),
  "toonforge.schedule_publish": publishArgs(),
  "toonforge.publish_video": publishArgs(),
  "toonforge.get_video_status": z.object({ idempotencyKey: z.string().min(1) }).strict(),
  "toonforge.get_analytics": z.object({ youtubeId: z.string().optional() }).strict(),
  "toonforge.run_daily_workflow": z.object({
    channelPath: z.string().optional(),
    dryRun: z.boolean().optional(),
    pipelineMode: pipelineMode.optional(),
    referencePath: z.string().optional(),
    referenceUrl: z.string().optional(),
  }).strict(),
  "toonforge.get_workflow_status": z.object({ workflowId: z.string().min(1) }).strict(),
  "toonforge.pause": z.object({}).strict(),
  "toonforge.resume": z.object({}).strict(),
  "toonforge.setup_status": z.object({}).strict(),
  "toonforge.youtube_status": z.object({}).strict(),
  "toonforge.scheduler_status": z.object({}).strict(),
  "toonforge.scheduler_preview": z.object({ channelPath: z.string().optional(), count: z.number().int().positive().max(10).optional() }).strict(),
  "toonforge.publish_preflight": z.object({ channelPath: z.string().optional() }).strict(),
  "toonforge.pause_channel": z.object({ channelId: z.string().min(1) }).strict(),
  "toonforge.resume_channel": z.object({ channelId: z.string().min(1) }).strict(),
};

function publishArgs() {
  return z
    .object({
      projectId: z.string().min(1),
      videoId: z.string().optional(),
      videoPath: z.string().min(1),
      idempotencyKey: z.string().optional(),
      dryRun: z.boolean().optional(),
      workflowState: z.string().optional(),
      qaStatus: z.enum(["PASS", "FAIL", "WARN"]),
      metadata: publishMetadata,
    })
    .strict();
}

export function validateToolArgs(name: string, args: Record<string, unknown>, maxBytes: number): Record<string, unknown> {
  const encoded = JSON.stringify(args);
  if (encoded.length > maxBytes) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: "MCP tool arguments exceed the size limit",
      component: "mcp.validate",
    });
  }
  const schema = schemas[name];
  if (!schema) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: `Unknown tool: ${name}`,
      component: "mcp.validate",
    });
  }
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: "MCP tool arguments failed validation",
      component: "mcp.validate",
      context: { issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) },
    });
  }
  return parsed.data as Record<string, unknown>;
}

export function toolSchemaJson(name: string): Record<string, unknown> {
  const schema = schemas[name];
  if (!schema) return { type: "object", additionalProperties: false };
  return zodToJson(schema);
}

function zodToJson(schema: z.ZodTypeAny): Record<string, unknown> {
  const json = zodObjectToJson(schema);
  return json ?? { type: "object", additionalProperties: false };
}

function zodObjectToJson(schema: z.ZodTypeAny): Record<string, unknown> | null {
  if (schema instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    for (const [key, value] of Object.entries(shape)) {
      const unwrapped = value instanceof z.ZodOptional ? value.unwrap() : value;
      if (!(value instanceof z.ZodOptional)) required.push(key);
      properties[key] = leafJson(unwrapped);
    }
    return {
      type: "object",
      properties,
      additionalProperties: false,
      ...(required.length ? { required } : {}),
    };
  }
  return null;
}

function leafJson(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: schema.options };
  if (schema instanceof z.ZodArray) return { type: "array" };
  if (schema instanceof z.ZodObject) return zodObjectToJson(schema) ?? { type: "object" };
  if (schema instanceof z.ZodUnknown) return {};
  if (schema instanceof z.ZodOptional) return leafJson(schema.unwrap());
  return {};
}
