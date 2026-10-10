#!/usr/bin/env node
/**
 * ToonForge MCP server (stdio).
 * Client-agnostic: Claude, Cursor, ChatGPT, Gemini, or any MCP client.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { handleTool, listPrompts, listResources, readResource } from "./handlers.js";
import { toolSchemaJson } from "./validate.js";
import { ToonForgeError } from "../core/errors.js";

export const MCP_TOOL_NAMES = [
  "toonforge.system_status",
  "toonforge.doctor",
  "toonforge.discover_trends",
  "toonforge.analyze_reference",
  "toonforge.score_trends",
  "toonforge.list_characters",
  "toonforge.get_character",
  "toonforge.validate_character",
  "toonforge.select_characters",
  "toonforge.generate_story",
  "toonforge.validate_story",
  "toonforge.create_storyboard",
  "toonforge.generate_cartoon",
  "toonforge.review_video",
  "toonforge.generate_voice",
  "toonforge.generate_music",
  "toonforge.generate_captions",
  "toonforge.generate_thumbnail",
  "toonforge.generate_metadata",
  "toonforge.run_qa",
  "toonforge.prepare_publish",
  "toonforge.schedule_publish",
  "toonforge.publish_video",
  "toonforge.get_video_status",
  "toonforge.get_analytics",
  "toonforge.openmontage_health",
  "toonforge.production_backends",
  "toonforge.run_daily_workflow",
  "toonforge.get_workflow_status",
  "toonforge.pause",
  "toonforge.resume",
  "toonforge.setup_status",
  "toonforge.youtube_status",
  "toonforge.scheduler_status",
  "toonforge.scheduler_preview",
  "toonforge.publish_preflight",
  "toonforge.pause_channel",
  "toonforge.resume_channel",
] as const;

export function createToonForgeMcpServer(): Server {
  const server = new Server(
    { name: "toonforge", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  const descriptions: Record<string, string> = {
    "toonforge.system_status": "Adapter/config/budget status",
    "toonforge.doctor": "Environment doctor checks",
    "toonforge.discover_trends": "Discover cartoon-suitable trend candidates",
    "toonforge.analyze_reference": "Analyze reference structure (not copy assets)",
    "toonforge.score_trends": "Score trend metrics",
    "toonforge.list_characters": "List canonical characters",
    "toonforge.get_character": "Get one character",
    "toonforge.validate_character": "Validate character + optional OmniChar continuity",
    "toonforge.select_characters": "Resolve characters for a story",
    "toonforge.generate_story": "Generate an original story",
    "toonforge.validate_story": "Validate story completeness/originality flags",
    "toonforge.create_storyboard": "Build deterministic storyboard",
    "toonforge.generate_cartoon": "Produce cartoon artifact (offline fixture, ReelMimic, or OpenMontage)",
    "toonforge.openmontage_health": "OpenMontage install and probe status",
    "toonforge.production_backends": "Availability of offline, ReelMimic, and OpenMontage backends",
    "toonforge.review_video": "Alias of run_qa",
    "toonforge.generate_voice": "Generate voice audio bundle",
    "toonforge.generate_music": "Generate music/mix bundle",
    "toonforge.generate_captions": "Generate captions package",
    "toonforge.generate_thumbnail": "Generate thumbnail package",
    "toonforge.generate_metadata": "Generate metadata package",
    "toonforge.run_qa": "Run QA gates",
    "toonforge.prepare_publish": "Prepare publication. Live upload also requires the operator opt-in.",
    "toonforge.schedule_publish": "Schedule publish. Live upload also requires the operator opt-in.",
    "toonforge.publish_video": "Publish video. dryRun false alone cannot enable a live upload.",
    "toonforge.get_video_status": "Read publication manifest",
    "toonforge.get_analytics": "Fetch analytics if configured",
    "toonforge.run_daily_workflow": "Run resumable daily workflow. Defaults to dry-run.",
    "toonforge.get_workflow_status": "Orchestrator workflow status",
    "toonforge.pause": "Pause irreversible MCP actions and the persistent scheduler",
    "toonforge.resume": "Resume MCP actions and the persistent scheduler",
    "toonforge.setup_status": "Dependency and setup status without writing client config",
    "toonforge.youtube_status": "YouTube authorization status without secrets",
    "toonforge.scheduler_status": "Persistent scheduler jobs and pause state",
    "toonforge.scheduler_preview": "Next local schedule instants. Does not generate or publish.",
    "toonforge.publish_preflight": "Channel, privacy, schedule, backend, and live-publish blockers",
    "toonforge.pause_channel": "Pause one channel id in the scheduler",
    "toonforge.resume_channel": "Resume one channel id in the scheduler",
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MCP_TOOL_NAMES.map((name) => ({
      name,
      description: descriptions[name] ?? name,
      inputSchema: toolSchemaJson(name),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      // Safety: never expose env secrets through tool results.
      const result = await handleTool(name, args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const typed = error instanceof ToonForgeError ? error.toJSON() : undefined;
      const payload = {
        error: true,
        tool: name,
        code: typed?.code ?? "TOOL_ERROR",
        message: error instanceof Error ? error.message : String(error),
        retryable: typed?.retryable ?? false,
        remediation: typed?.context && typeof typed.context === "object" ? (typed.context as { remediation?: string }).remediation : undefined,
      };
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listResources().map((r) => ({
      uri: r.uri,
      name: r.name,
      mimeType: r.mimeType,
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const text = await readResource(request.params.uri);
    return {
      contents: [{ uri: request.params.uri, mimeType: "text/plain", text }],
    };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: listPrompts(),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const name = request.params.name;
    const map: Record<string, string> = {
      daily_production: "Call toonforge.run_daily_workflow with dryRun=true, then inspect QA and publish manifest.",
      create_cartoon: "discover_trends → generate_story → create_storyboard → generate_cartoon → run_qa",
      analyze_trend: "Call toonforge.discover_trends then toonforge.score_trends",
      review_video: "Call toonforge.run_qa with artifact paths",
      publish_video: "Only after QA PASS. Use toonforge.publish_video with dryRun=true first.",
      analyze_channel: "Read toonforge://channel/cartoon-default and toonforge://characters",
    };
    return {
      description: name,
      messages: [
        {
          role: "user",
          content: { type: "text", text: map[name] ?? `Prompt ${name}` },
        },
      ],
    };
  });

  return server;
}

export async function startMcpStdio(): Promise<void> {
  const server = createToonForgeMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpStdio().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
