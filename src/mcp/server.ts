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
  "toonforge.run_daily_workflow",
  "toonforge.get_workflow_status",
  "toonforge.pause",
  "toonforge.resume",
] as const;

function toolDef(name: string, description: string, properties: Record<string, unknown> = {}) {
  return {
    name,
    description,
    inputSchema: {
      type: "object" as const,
      properties,
      additionalProperties: true,
    },
  };
}

export function createToonForgeMcpServer(): Server {
  const server = new Server(
    { name: "toonforge", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      toolDef("toonforge.system_status", "Adapter/config/budget status"),
      toolDef("toonforge.doctor", "Environment doctor checks"),
      toolDef("toonforge.discover_trends", "Discover cartoon-suitable trend candidates", {
        channelPath: { type: "string" },
        limit: { type: "number" },
      }),
      toolDef("toonforge.analyze_reference", "Analyze reference structure (not copy assets)", {
        sourcePath: { type: "string" },
        sourceUrl: { type: "string" },
        outDir: { type: "string" },
      }),
      toolDef("toonforge.score_trends", "Score trend metrics"),
      toolDef("toonforge.list_characters", "List canonical characters"),
      toolDef("toonforge.get_character", "Get one character", { characterId: { type: "string" } }),
      toolDef("toonforge.validate_character", "Validate character + optional OmniChar continuity", {
        characterId: { type: "string" },
      }),
      toolDef("toonforge.select_characters", "Resolve characters for a story"),
      toolDef("toonforge.generate_story", "Generate an original story"),
      toolDef("toonforge.validate_story", "Validate story completeness/originality flags"),
      toolDef("toonforge.create_storyboard", "Build deterministic storyboard"),
      toolDef("toonforge.generate_cartoon", "Produce cartoon artifact (local stub or ReelMimic)"),
      toolDef("toonforge.review_video", "Alias of run_qa"),
      toolDef("toonforge.generate_voice", "Generate voice audio bundle"),
      toolDef("toonforge.generate_music", "Generate music/mix bundle"),
      toolDef("toonforge.generate_captions", "Generate captions package"),
      toolDef("toonforge.generate_thumbnail", "Generate thumbnail package"),
      toolDef("toonforge.generate_metadata", "Generate metadata package"),
      toolDef("toonforge.run_qa", "Run QA gates"),
      toolDef("toonforge.prepare_publish", "Prepare publication (dry-run by default)"),
      toolDef("toonforge.schedule_publish", "Schedule publish (dry-run by default)"),
      toolDef("toonforge.publish_video", "Publish video (dry-run by default)"),
      toolDef("toonforge.get_video_status", "Read publication manifest"),
      toolDef("toonforge.get_analytics", "Fetch analytics if configured"),
      toolDef("toonforge.run_daily_workflow", "Run resumable daily dry-run workflow", {
        channelPath: { type: "string" },
        dryRun: { type: "boolean" },
      }),
      toolDef("toonforge.get_workflow_status", "Orchestrator workflow status", {
        workflowId: { type: "string" },
      }),
      toolDef("toonforge.pause", "Pause irreversible MCP actions"),
      toolDef("toonforge.resume", "Resume MCP actions"),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    // Safety: never expose env secrets through tool results.
    const result = await handleTool(name, args);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
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
