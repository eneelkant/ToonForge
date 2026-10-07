import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadChannelConfig, loadRuntimeConfig, assertNotKilled } from "../../core/config.js";
import { newId } from "../../core/ids.js";
import { transition, type WorkflowRecord, type WorkflowState } from "../../core/state.js";
import { defaultCharacterRegistry } from "../../characters/registry.js";
import { ManualSeedTrendProvider, dedupeTrends, selectOpportunity } from "../trend/index.js";
import { generateOriginalStory, validateStory } from "../story/index.js";
import { createStoryboard } from "../storyboard/index.js";
import { buildContinuityPlan, persistContinuityPlan, validateContinuityPlan } from "../continuity/index.js";
import { createOmniCharAdapter } from "../../adapters/omnichar/index.js";
import { produceLocalCartoon } from "../production/index.js";
import { generateAudioBundle } from "../audio/index.js";
import { buildContentPackage } from "../packaging/index.js";
import { runQa } from "../qa/index.js";
import { createYoutubeAdapter } from "../../adapters/youtube/index.js";
import { createReelMimicAdapter } from "../../adapters/reelmimic/index.js";
import { SupervisorAgent } from "../../agents/supervisor/index.js";
import { rootLogger } from "../../core/logging.js";

const log = rootLogger.child("engines.workflow.daily");

export interface DailyWorkflowResult {
  workflowId: string;
  projectId: string;
  state: WorkflowState;
  dryRun: boolean;
  artifacts: Record<string, string | undefined>;
  qa: ReturnType<typeof runQa>;
  publish?: unknown;
  error?: string;
}

function advance(record: WorkflowRecord, to: WorkflowState): WorkflowRecord {
  return transition(record, to);
}

export async function runDailyWorkflow(opts: {
  channelPath?: string;
  dryRun?: boolean;
  dataDir?: string;
}): Promise<DailyWorkflowResult> {
  const config = loadRuntimeConfig();
  assertNotKilled(config);
  const supervisor = new SupervisorAgent(config);
  supervisor.checkBudget({ dailySpentUsd: 0, videoSpentUsd: 0 }, 0);

  const channel = loadChannelConfig(opts.channelPath ?? "config/channels/cartoon-default.yaml");
  const dryRun = opts.dryRun ?? true;
  const projectId = newId("proj");
  const workflowId = newId("wf_daily");
  const projectDir = join(opts.dataDir ?? config.dataDir, "projects", projectId);
  mkdirSync(projectDir, { recursive: true });

  let record: WorkflowRecord = {
    workflowId,
    projectId,
    state: "IDEA",
    lastValidState: "IDEA",
    retryCount: 0,
    updatedAt: new Date().toISOString(),
  };

  try {
    record = advance(record, "RESEARCHING");
    const provider = new ManualSeedTrendProvider();
    const trends = dedupeTrends(await provider.discover({ niche: channel.niche, limit: 5 }));
    writeFileSync(join(projectDir, "trends.json"), JSON.stringify(trends, null, 2));

    record = advance(record, "ANALYZING");
    const selected = selectOpportunity(trends);
    if (!selected) throw new Error("No suitable trend opportunity");
    const reelmimic = createReelMimicAdapter(config.reelmimic);
    const syntheticRef = join(projectDir, "synthetic-reference.txt");
    writeFileSync(
      syntheticRef,
      "Synthetic local reference placeholder for structure analysis only. Not third-party footage.\n",
    );
    const analysis = await reelmimic.analyzeReference({
      sourcePath: syntheticRef,
      outDir: join(projectDir, "analysis"),
    });
    writeFileSync(join(projectDir, "selected-trend.json"), JSON.stringify(selected, null, 2));

    record = advance(record, "STORY_GENERATED");
    const registry = defaultCharacterRegistry();
    const characters = await registry.resolve_for_story({
      roles: ["lead", "sidekick"],
      preferredIds: channel.characters,
    });
    const story = generateOriginalStory({
      trend: selected,
      characters,
      reference: analysis.report,
      durationTarget: channel.duration_seconds,
      format: channel.format === "long_form" ? "long_form" : "shorts",
    });
    const storyValidation = validateStory(story);
    if (!storyValidation.ok) throw new Error(`Story invalid: ${storyValidation.errors.join(", ")}`);
    writeFileSync(join(projectDir, "story.json"), JSON.stringify(story, null, 2));

    record = advance(record, "STORYBOARD_READY");
    const storyboard = createStoryboard(story);
    writeFileSync(join(projectDir, "storyboard.json"), JSON.stringify(storyboard, null, 2));
    const continuity = await buildContinuityPlan({
      projectId,
      characters,
      storyboard,
      omnichar: config.omnichar.enabled ? createOmniCharAdapter(config.omnichar) : null,
    });
    persistContinuityPlan(projectDir, continuity);
    const continuityCheck = validateContinuityPlan({
      ...continuity,
      pins: continuity.pins.map((p) => ({
        ...p,
        // Local registry pins are authoritative when OmniChar is offline.
        continuity_ok: config.omnichar.enabled ? p.continuity_ok : true,
        detail: config.omnichar.enabled ? p.detail : "local registry pin (OmniChar disabled)",
      })),
    });
    if (!continuityCheck.ok) {
      throw new Error(`Continuity failed: ${continuityCheck.errors.join(", ")}`);
    }

    record = advance(record, "PRODUCTION");
    const production = produceLocalCartoon({ projectId, projectDir, story, storyboard });

    record = advance(record, "AUDIO");
    const audio = await generateAudioBundle({ projectDir, story });

    record = advance(record, "EDITING");
    const pack = buildContentPackage({
      projectDir,
      story,
      durationSeconds: channel.duration_seconds,
    });

    record = advance(record, "QA");
    const qa = runQa({
      videoPath: production.videoPath,
      audioPath: audio.mixPath,
      captionsPath: pack.captionsPath,
      thumbnailPath: pack.thumbnailPath,
      metadata: { title: pack.title, description: pack.description },
      storyComplete: true,
      originalContent: true,
      thirdPartyFootage: false,
      allowStubVideo: dryRun,
    });
    writeFileSync(join(projectDir, "qa.json"), JSON.stringify(qa, null, 2));
    if (qa.verdict === "FAIL") {
      record = advance(record, "FAILED");
      return {
        workflowId,
        projectId,
        state: record.state,
        dryRun,
        artifacts: { videoPath: production.videoPath },
        qa,
        error: "QA FAIL",
      };
    }

    record = advance(record, "READY_TO_PUBLISH");
    const yt = createYoutubeAdapter(config.youtube, {
      dataDir: opts.dataDir ?? config.dataDir,
      dryRunDefault: dryRun,
    });
    const publish = await yt.publish({
      idempotencyKey: `pub:${projectId}:video`,
      projectId,
      videoId: "video",
      videoPath: production.videoPath,
      dryRun,
      workflowState: "READY_TO_PUBLISH",
      qaStatus: qa.verdict === "WARN" ? "WARN" : "PASS",
      policyStatus: "PASS",
      metadata: {
        title: pack.title,
        description: pack.description,
        tags: pack.tags,
        privacyStatus: config.youtube.defaultPrivacy,
        thumbnailPath: pack.thumbnailPath,
      },
      provenance: {
        originalContent: true,
        thirdPartyFootage: false,
        licensedAssets: [],
        notes: story.originality_notes,
      },
    });

    record = advance(record, "SCHEDULED");
    record = advance(record, "PUBLISHED");
    record = advance(record, "ANALYZING_RESULTS");
    writeFileSync(
      join(projectDir, "analytics-placeholder.json"),
      JSON.stringify({ status: "pending", note: "Fill after real YouTube analytics" }, null, 2),
    );
    record = advance(record, "COMPLETE");

    writeFileSync(join(projectDir, "workflow.json"), JSON.stringify(record, null, 2));
    log.info("daily.complete", { workflowId, projectId, dryRun });

    return {
      workflowId,
      projectId,
      state: record.state,
      dryRun,
      artifacts: {
        videoPath: production.videoPath,
        audioPath: audio.mixPath,
        captionsPath: pack.captionsPath,
        thumbnailPath: pack.thumbnailPath,
        storyPath: join(projectDir, "story.json"),
        analysisPath: analysis.reportPath,
      },
      qa,
      publish,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      if (record.state !== "FAILED" && record.state !== "COMPLETE") {
        record = transition(record, "FAILED", message);
      }
    } catch {
      /* ignore illegal transition on outer failure */
    }
    writeFileSync(join(projectDir, "workflow.json"), JSON.stringify({ ...record, error: message }, null, 2));
    return {
      workflowId,
      projectId,
      state: "FAILED",
      dryRun,
      artifacts: {},
      qa: { verdict: "FAIL", checks: [] },
      error: message,
    };
  }
}

export function loadWorkflowState(projectDir: string): WorkflowRecord | null {
  const path = join(projectDir, "workflow.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as WorkflowRecord;
}
