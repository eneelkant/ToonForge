import { loadChannelConfig, loadRuntimeConfig } from "../core/config.js";
import { defaultCharacterRegistry } from "../characters/registry.js";
import { getSystemStatus } from "./tools/system.js";
import { runDoctor } from "../cli/doctor.js";
import { createReelMimicAdapter } from "../adapters/reelmimic/index.js";
import { createYoutubeAdapter } from "../adapters/youtube/index.js";
import { createOrchestrator } from "../adapters/ruflo/index.js";
import { createOmniCharAdapter } from "../adapters/omnichar/index.js";
import {
  discoverTrendsForChannel,
  scoreTrend,
} from "../engines/trend/index.js";
import { resolvePipelineMode, type PipelineMode } from "../engines/reference/index.js";
import { createOpenMontageAdapter } from "../adapters/openmontage/index.js";
import { generateOriginalStory, validateStory } from "../engines/story/index.js";
import { createStoryboard } from "../engines/storyboard/index.js";
import { produceCartoon } from "../engines/production/index.js";
import { generateAudioBundle } from "../engines/audio/index.js";
import { buildContentPackage } from "../engines/packaging/index.js";
import { runQa } from "../engines/qa/index.js";
import { runDailyWorkflow } from "../engines/workflow/daily.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { newId } from "../core/ids.js";

let paused = false;

export async function handleTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (
    paused &&
    ![
      "toonforge.resume",
      "toonforge.system_status",
      "toonforge.doctor",
      "toonforge.get_workflow_status",
      "toonforge.openmontage_health",
      "toonforge.production_backends",
    ].includes(name)
  ) {
    return { error: "system paused", code: "PAUSED" };
  }

  const config = loadRuntimeConfig();

  switch (name) {
    case "toonforge.system_status":
      return getSystemStatus(config);
    case "toonforge.doctor": {
      const lines: string[] = [];
      const originalLog = console.log;
      console.log = (...a: unknown[]) => {
        lines.push(a.map(String).join(" "));
      };
      try {
        await runDoctor();
      } finally {
        console.log = originalLog;
      }
      return { lines };
    }
    case "toonforge.discover_trends": {
      const channel = loadChannelConfig(String(args.channelPath ?? "config/channels/cartoon-default.yaml"));
      const { trends, providers } = await discoverTrendsForChannel({
        trendSources: channel.trend_sources,
        niche: channel.niche,
        limit: Number(args.limit ?? 5),
        providerOptions: { youtubeTrends: config.youtubeTrends, niche: channel.niche },
      });
      return { providers, trends, trend_sources: channel.trend_sources };
    }
    case "toonforge.score_trends": {
      const trends = (args.trends as Array<Record<string, number>>) ?? [];
      return trends.map((t) => ({
        ...t,
        score: scoreTrend({
          velocity: Number(t.velocity ?? 0.5),
          engagement: Number(t.engagement ?? 0.5),
          freshness: Number(t.freshness ?? 0.5),
          nicheFit: Number(t.nicheFit ?? 0.5),
          originality: Number(t.originality ?? 0.5),
          saturation: Number(t.saturation ?? 0.3),
          policyRisk: Number(t.policyRisk ?? 0.1),
        }),
      }));
    }
    case "toonforge.analyze_reference": {
      const adapter = createReelMimicAdapter(config.reelmimic);
      const outDir = String(args.outDir ?? join(config.dataDir, "analysis", newId("ref")));
      return adapter.analyzeReference({
        sourcePath: args.sourcePath ? String(args.sourcePath) : undefined,
        sourceUrl: args.sourceUrl ? String(args.sourceUrl) : undefined,
        outDir,
      });
    }
    case "toonforge.list_characters":
      return defaultCharacterRegistry().list();
    case "toonforge.get_character": {
      const id = String(args.characterId ?? "");
      return defaultCharacterRegistry().get(id);
    }
    case "toonforge.validate_character": {
      const id = String(args.characterId ?? "");
      const character = await defaultCharacterRegistry().get(id);
      if (!character) return { ok: false, errors: ["not found"] };
      const local = await defaultCharacterRegistry().validate(character);
      const omni = createOmniCharAdapter(config.omnichar);
      const continuity =
        config.omnichar.enabled ? await omni.validateContinuity(id).catch((e) => ({ error: String(e) })) : { skipped: true };
      return { local, continuity };
    }
    case "toonforge.generate_story": {
      const channel = loadChannelConfig(String(args.channelPath ?? "config/channels/cartoon-default.yaml"));
      const characters = await defaultCharacterRegistry().resolve_for_story({
        roles: ["lead", "sidekick"],
        preferredIds: (args.characterIds as string[]) ?? channel.characters,
      });
      const story = generateOriginalStory({
        characters,
        durationTarget: channel.duration_seconds,
        format: channel.format === "long_form" ? "long_form" : "shorts",
        trend: args.trend as never,
      });
      return story;
    }
    case "toonforge.validate_story":
      return validateStory(args.story as never);
    case "toonforge.create_storyboard":
      return createStoryboard(args.story as never);
    case "toonforge.openmontage_health":
      return createOpenMontageAdapter(config.openmontage).health();
    case "toonforge.production_backends": {
      const openmontage = await createOpenMontageAdapter(config.openmontage).health();
      const reelmimic = await createReelMimicAdapter(config.reelmimic).probe();
      return {
        selected: resolvePipelineMode({
          reelmimicEnabled: config.reelmimic.enabled,
          openmontageEnabled: config.openmontage.enabled,
          preferOfflineFixture: true,
        }),
        backends: {
          offline_fixture: { status: "ready", detail: "explicit ffmpeg_dev fixture" },
          reelmimic,
          openmontage,
        },
      };
    }
    case "toonforge.generate_cartoon": {
      const projectId = String(args.projectId ?? newId("proj"));
      const projectDir = String(args.projectDir ?? join(config.dataDir, "projects", projectId));
      mkdirSync(projectDir, { recursive: true });
      const requested = args.pipelineMode;
      const mode = resolvePipelineMode({
        reelmimicEnabled: config.reelmimic.enabled,
        openmontageEnabled: config.openmontage.enabled,
        mode:
          requested === "reelmimic" || requested === "openmontage" || requested === "offline_fixture"
            ? requested
            : undefined,
        preferOfflineFixture: true,
      });
      const characters =
        mode === "openmontage" ? await defaultCharacterRegistry().list() : undefined;
      return produceCartoon({
        projectId,
        projectDir,
        story: args.story as never,
        storyboard: args.storyboard as never,
        characters,
        reelmimic: mode === "reelmimic" ? createReelMimicAdapter(config.reelmimic) : null,
        openmontage: mode === "openmontage" ? createOpenMontageAdapter(config.openmontage) : null,
        mode,
        referencePath: args.referencePath ? String(args.referencePath) : undefined,
        referenceUrl: args.referenceUrl ? String(args.referenceUrl) : undefined,
      });
    }
    case "toonforge.generate_voice":
    case "toonforge.generate_music": {
      const projectDir = String(args.projectDir ?? join(config.dataDir, "projects", "tmp"));
      return generateAudioBundle({ projectDir, story: args.story as never });
    }
    case "toonforge.generate_captions":
    case "toonforge.generate_thumbnail":
    case "toonforge.generate_metadata": {
      const projectDir = String(args.projectDir ?? join(config.dataDir, "projects", "tmp"));
      return buildContentPackage({
        projectDir,
        story: args.story as never,
        durationSeconds: Number(args.durationSeconds ?? 45),
      });
    }
    case "toonforge.run_qa":
    case "toonforge.review_video":
      return runQa({
        videoPath: args.videoPath ? String(args.videoPath) : undefined,
        audioPath: args.audioPath ? String(args.audioPath) : undefined,
        captionsPath: args.captionsPath ? String(args.captionsPath) : undefined,
        thumbnailPath: args.thumbnailPath ? String(args.thumbnailPath) : undefined,
        metadata: args.metadata as { title?: string; description?: string } | undefined,
        storyComplete: args.storyComplete !== false,
        originalContent: args.originalContent !== false,
        thirdPartyFootage: Boolean(args.thirdPartyFootage),
        allowDevFixtures: args.allowDevFixtures !== false,
      });
    case "toonforge.prepare_publish":
    case "toonforge.schedule_publish":
    case "toonforge.publish_video": {
      const yt = createYoutubeAdapter(config.youtube, { dryRunDefault: true });
      return yt.publish({
        idempotencyKey: String(args.idempotencyKey ?? `pub:${args.projectId}:${args.videoId}`),
        projectId: String(args.projectId),
        videoId: String(args.videoId ?? "video"),
        videoPath: String(args.videoPath),
        dryRun: args.dryRun !== false,
        workflowState: String(args.workflowState ?? "READY_TO_PUBLISH"),
        qaStatus: (args.qaStatus as "PASS" | "FAIL" | "WARN") ?? "PASS",
        policyStatus: "PASS",
        metadata: args.metadata as never,
        provenance: {
          originalContent: true,
          thirdPartyFootage: false,
          licensedAssets: [],
          notes: [],
        },
      });
    }
    case "toonforge.get_video_status": {
      const yt = createYoutubeAdapter(config.youtube);
      return yt.getManifest(String(args.idempotencyKey));
    }
    case "toonforge.get_analytics":
      return { status: "pending", note: "Requires live YouTube analytics credentials" };
    case "toonforge.run_daily_workflow":
      return runDailyWorkflow({
        channelPath: args.channelPath ? String(args.channelPath) : undefined,
        dryRun: args.dryRun !== false,
        pipelineMode:
          args.pipelineMode === "reelmimic" ||
          args.pipelineMode === "offline_fixture" ||
          args.pipelineMode === "openmontage"
            ? (args.pipelineMode as PipelineMode)
            : undefined,
        referencePath: args.referencePath ? String(args.referencePath) : undefined,
        referenceUrl: args.referenceUrl ? String(args.referenceUrl) : undefined,
      });
    case "toonforge.get_workflow_status": {
      const orch = createOrchestrator(config.ruflo);
      return orch.workflow.status(String(args.workflowId));
    }
    case "toonforge.pause":
      paused = true;
      return { paused: true };
    case "toonforge.resume":
      paused = false;
      return { paused: false };
    case "toonforge.select_characters": {
      return defaultCharacterRegistry().resolve_for_story({
        roles: (args.roles as string[]) ?? ["lead"],
        preferredIds: args.preferredIds as string[] | undefined,
      });
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export function listResources() {
  return [
    { uri: "toonforge://channel/cartoon-default", name: "Default channel config", mimeType: "application/yaml" },
    { uri: "toonforge://characters", name: "Character registry", mimeType: "application/json" },
    { uri: "toonforge://health", name: "System health", mimeType: "application/json" },
    { uri: "toonforge://docs/architecture", name: "Architecture docs", mimeType: "text/markdown" },
  ];
}

export async function readResource(uri: string): Promise<string> {
  if (uri === "toonforge://channel/cartoon-default") {
    const { readFileSync } = await import("node:fs");
    return readFileSync("config/channels/cartoon-default.yaml", "utf8");
  }
  if (uri === "toonforge://characters") {
    return JSON.stringify(await defaultCharacterRegistry().list(), null, 2);
  }
  if (uri === "toonforge://health") {
    return JSON.stringify(await getSystemStatus(loadRuntimeConfig()), null, 2);
  }
  if (uri === "toonforge://docs/architecture") {
    const { readFileSync } = await import("node:fs");
    return readFileSync("docs/architecture.md", "utf8");
  }
  throw new Error(`Unknown resource: ${uri}`);
}

export function listPrompts() {
  return [
    { name: "daily_production", description: "Run the daily original cartoon workflow in dry-run" },
    { name: "create_cartoon", description: "Create an original cartoon from a trend topic" },
    { name: "analyze_trend", description: "Discover and score cartoon-suitable trends" },
    { name: "review_video", description: "Run QA gates on a project" },
    { name: "publish_video", description: "Prepare/publish with dry-run safety" },
    { name: "analyze_channel", description: "Inspect channel configuration and characters" },
  ];
}
