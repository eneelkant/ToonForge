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
import { produceCartoon } from "../production/index.js";
import { generateAudioBundle } from "../audio/index.js";
import { buildContentPackage } from "../packaging/index.js";
import { runQa } from "../qa/index.js";
import { createYoutubeAdapter } from "../../adapters/youtube/index.js";
import { createReelMimicAdapter } from "../../adapters/reelmimic/index.js";
import { SupervisorAgent } from "../../agents/supervisor/index.js";
import { rootLogger } from "../../core/logging.js";
import {
  emptyProvenance,
  persistProvenance,
  stamp,
  type ProvenanceRecord,
} from "../../core/provenance.js";
import { muxVideoAudio, writeMediaSidecar } from "../../core/media.js";

const log = rootLogger.child("engines.workflow.daily");

export interface DailyWorkflowResult {
  workflowId: string;
  projectId: string;
  channelId: string;
  state: WorkflowState;
  dryRun: boolean;
  artifacts: Record<string, string | undefined>;
  qa: Awaited<ReturnType<typeof runQa>>;
  publish?: unknown;
  provenancePath?: string;
  error?: string;
}

function advance(record: WorkflowRecord, to: WorkflowState): WorkflowRecord {
  return transition(record, to);
}

function persistWorkflow(projectDir: string, record: WorkflowRecord, extra?: Record<string, unknown>): void {
  writeFileSync(
    join(projectDir, "workflow.json"),
    JSON.stringify({ ...record, ...extra }, null, 2),
  );
}

export async function runDailyWorkflow(opts: {
  channelPath?: string;
  dryRun?: boolean;
  dataDir?: string;
  /** When true and dryRun=false, attempt live publish (still gated). */
  publish?: boolean;
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
  persistWorkflow(projectDir, record, { channelId: channel.channel_id });

  const provenance: ProvenanceRecord = emptyProvenance();
  provenance.timestamps.push(stamp("workflow.start"));
  provenance.creativeTransformations.push(
    "Trend/reference used for pacing/structure signals only — original script, characters, and media",
  );
  provenance.providers.push({ name: "toonforge.local", role: "orchestrator" });

  try {
    record = advance(record, "RESEARCHING");
    persistWorkflow(projectDir, record);
    log.info("daily.state", { workflowId, projectId, channelId: channel.channel_id, state: record.state });

    const provider = new ManualSeedTrendProvider();
    const trends = dedupeTrends(await provider.discover({ niche: channel.niche, limit: 5 }));
    writeFileSync(join(projectDir, "trends.json"), JSON.stringify(trends, null, 2));
    provenance.timestamps.push(stamp("trends.discovered"));

    record = advance(record, "ANALYZING");
    persistWorkflow(projectDir, record);
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
    provenance.referenceSources.push({
      id: selected.id,
      role: "trend_structure",
      notes: "Topic/pacing inspiration only",
    });
    provenance.timestamps.push(stamp("reference.analyzed"));

    record = advance(record, "STORY_GENERATED");
    persistWorkflow(projectDir, record);
    const registry = defaultCharacterRegistry();
    const characters = await registry.resolve_for_story({
      roles: ["lead", "sidekick"],
      preferredIds: channel.characters,
    });
    // Enforce known recurring cast when channel lists them.
    for (const id of channel.characters) {
      const known = await registry.get(id);
      if (!known) {
        throw new Error(`Channel character missing from registry: ${id}`);
      }
    }
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
    for (const c of characters) {
      provenance.charactersUsed.push({
        id: c.character_id,
        version: c.version ?? "1",
      });
    }
    provenance.timestamps.push(stamp("story.generated"));

    record = advance(record, "STORYBOARD_READY");
    persistWorkflow(projectDir, record);
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
        continuity_ok: config.omnichar.enabled ? p.continuity_ok : true,
        detail: config.omnichar.enabled ? p.detail : "local registry pin (OmniChar disabled)",
      })),
    });
    if (!continuityCheck.ok) {
      throw new Error(`Continuity failed: ${continuityCheck.errors.join(", ")}`);
    }
    provenance.timestamps.push(stamp("storyboard.ready"));

    record = advance(record, "PRODUCTION");
    persistWorkflow(projectDir, record);
    const production = await produceCartoon({
      projectId,
      projectDir,
      story,
      storyboard,
      reelmimic: config.reelmimic.enabled ? reelmimic : null,
      allowDevFixture: dryRun || !config.reelmimic.enabled,
      durationSec: Math.min(6, Math.max(2, Math.floor(channel.duration_seconds / 15) || 3)),
    });
    provenance.generatedAssets.push({
      type: "video",
      path: production.videoPath,
      kind: production.kind,
      provider: production.kind === "reelmimic" ? "reelmimic" : "ffmpeg",
    });
    provenance.providers.push({
      name: production.kind === "reelmimic" ? "reelmimic" : "ffmpeg-dev",
      role: "video",
    });
    provenance.timestamps.push(stamp("production.complete"));

    record = advance(record, "AUDIO");
    persistWorkflow(projectDir, record);
    const audio = await generateAudioBundle({ projectDir, story, preferValidMedia: true });
    provenance.generatedAssets.push(
      { type: "audio", path: audio.mixPath, kind: audio.kind, provider: audio.provider },
      { type: "voice", path: audio.voicePath, kind: audio.kind, provider: audio.provider },
      { type: "music", path: audio.musicPath, kind: audio.kind, provider: audio.provider },
    );
    provenance.timestamps.push(stamp("audio.complete"));

    record = advance(record, "ASSEMBLY");
    persistWorkflow(projectDir, record);
    const assembledPath = join(projectDir, "out", "final.mp4");
    await muxVideoAudio({
      videoPath: production.videoPath,
      audioPath: audio.mixPath,
      outPath: assembledPath,
    });
    writeMediaSidecar(assembledPath, {
      kind: production.kind,
      provider: production.kind === "reelmimic" ? "reelmimic" : "ffmpeg",
      notes: ["assembled final mux"],
    });
    provenance.generatedAssets.push({
      type: "video",
      path: assembledPath,
      kind: production.kind,
      provider: production.kind === "reelmimic" ? "reelmimic" : "ffmpeg",
    });
    const pack = await buildContentPackage({
      projectDir,
      story,
      durationSeconds: channel.duration_seconds,
      realThumbnail: true,
    });
    provenance.generatedAssets.push({
      type: "thumbnail",
      path: pack.thumbnailPath,
      kind: pack.thumbnailKind,
      provider: "ffmpeg",
    });
    provenance.generatedAssets.push({
      type: "captions",
      path: pack.captionsPath,
      kind: "provider",
      provider: "toonforge",
    });
    provenance.timestamps.push(stamp("assembly.complete"));

    record = advance(record, "QA");
    persistWorkflow(projectDir, record);
    const provenancePath = persistProvenance(projectDir, provenance);
    const qa = await runQa({
      videoPath: assembledPath,
      audioPath: audio.mixPath,
      captionsPath: pack.captionsPath,
      thumbnailPath: pack.thumbnailPath,
      metadata: { title: pack.title, description: pack.description },
      storyComplete: true,
      originalContent: true,
      thirdPartyFootage: false,
      allowDevFixtures: dryRun,
      provenance,
      expectedDurationSec: channel.duration_seconds,
      requireAudio: true,
    });
    writeFileSync(join(projectDir, "qa.json"), JSON.stringify(qa, null, 2));
    log.info("daily.qa", {
      workflowId,
      projectId,
      verdict: qa.verdict,
      mediaKinds: qa.mediaKinds,
    });

    if (qa.verdict === "FAIL") {
      record = advance(record, "FAILED");
      persistWorkflow(projectDir, record, { error: "QA FAIL" });
      return {
        workflowId,
        projectId,
        channelId: channel.channel_id,
        state: record.state,
        dryRun,
        artifacts: { videoPath: assembledPath },
        qa,
        provenancePath,
        error: "QA FAIL",
      };
    }

    record = advance(record, "READY_TO_PUBLISH");
    persistWorkflow(projectDir, record);

    const yt = createYoutubeAdapter(config.youtube, {
      dataDir: opts.dataDir ?? config.dataDir,
      dryRunDefault: dryRun,
    });
    const publish = await yt.publish({
      idempotencyKey: `pub:${projectId}:video`,
      projectId,
      videoId: "video",
      videoPath: assembledPath,
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
      fullProvenance: provenance,
    });

    record = advance(record, "SCHEDULED");
    persistWorkflow(projectDir, record);
    record = advance(record, "PUBLISHED");
    persistWorkflow(projectDir, record);
    record = advance(record, "ANALYZING_RESULTS");
    writeFileSync(
      join(projectDir, "analytics-placeholder.json"),
      JSON.stringify({ status: "pending", note: "Fill after real YouTube analytics" }, null, 2),
    );
    record = advance(record, "COMPLETE");
    provenance.timestamps.push(stamp("workflow.complete"));
    persistProvenance(projectDir, provenance);
    persistWorkflow(projectDir, record);
    log.info("daily.complete", { workflowId, projectId, dryRun, channelId: channel.channel_id });

    return {
      workflowId,
      projectId,
      channelId: channel.channel_id,
      state: record.state,
      dryRun,
      artifacts: {
        videoPath: assembledPath,
        sourceVideoPath: production.videoPath,
        audioPath: audio.mixPath,
        captionsPath: pack.captionsPath,
        thumbnailPath: pack.thumbnailPath,
        storyPath: join(projectDir, "story.json"),
        analysisPath: analysis.reportPath,
        provenancePath,
      },
      qa,
      publish,
      provenancePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("daily.failed", { workflowId, projectId, error: message, state: record.state });
    try {
      if (record.state !== "FAILED" && record.state !== "COMPLETE") {
        record = transition(record, "FAILED", message);
      }
    } catch {
      /* ignore illegal transition on outer failure */
    }
    persistProvenance(projectDir, provenance);
    persistWorkflow(projectDir, record, { error: message });
    return {
      workflowId,
      projectId,
      channelId: channel.channel_id,
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
