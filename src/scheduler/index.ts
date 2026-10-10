import { randomUUID } from "node:crypto";
import type { ChannelConfig, RuntimeConfig } from "../core/config.js";
import { ToonForgeError } from "../core/errors.js";
import { livePublishingEnabled } from "../core/publish-mode.js";
import { localSlotId, nextDailyUtc, parseDailyCron, zonedParts } from "./cron.js";
import {
  acquireSchedulerLock,
  appendAudit,
  loadControl,
  loadState,
  releaseSchedulerLock,
  saveControl,
  saveState,
  type ScheduledJob,
} from "./store.js";

export interface SchedulePreview {
  channelId: string;
  timezone: string;
  cron: string;
  enabled: boolean;
  nextRuns: string[];
}

export function previewChannel(channel: ChannelConfig, after = new Date(), count = 3): SchedulePreview {
  const cron = parseDailyCron(channel.schedule.cron);
  const nextRuns: string[] = [];
  let cursor = after;
  if (channel.schedule.enabled) {
    for (let i = 0; i < count; i += 1) {
      const next = nextDailyUtc(cron, channel.schedule.timezone, cursor);
      nextRuns.push(next.toISOString());
      cursor = next;
    }
  }
  return {
    channelId: channel.channel_id,
    timezone: channel.schedule.timezone,
    cron: channel.schedule.cron,
    enabled: channel.schedule.enabled,
    nextRuns,
  };
}

export interface TickInput {
  dataDir: string;
  now: Date;
  channels: ChannelConfig[];
  config: RuntimeConfig;
  owner?: string;
  execute: (job: ScheduledJob, channel: ChannelConfig, ctx: { dryRun: boolean }) => Promise<{ state: string; error?: string }>;
  backendReady?: (channel: ChannelConfig) => Promise<{ ok: boolean; detail: string }>;
}

function releaseStaleLeases(jobs: ScheduledJob[], now: Date): void {
  for (const job of jobs) {
    if (job.status === "leased" && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) <= now.getTime()) {
      job.status = "queued";
      job.leaseOwner = undefined;
      job.leaseExpiresAt = undefined;
    }
  }
}

function enqueue(dataDir: string, jobs: ScheduledJob[], channel: ChannelConfig, now: Date): void {
  if (!channel.schedule.enabled) return;
  const cron = parseDailyCron(channel.schedule.cron);
  const due = nextDailyUtc(cron, channel.schedule.timezone, new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (due.getTime() > now.getTime()) return;
  const age = now.getTime() - due.getTime();
  const id = localSlotId(channel.channel_id, channel.schedule.timezone, due);
  if (jobs.some((job) => job.id === id)) return;
  if (age > 24 * 60 * 60 * 1000) {
    const skipped: ScheduledJob = {
      id,
      channelId: channel.channel_id,
      dueAt: due.toISOString(),
      status: "skipped",
      attempts: 0,
      lastError: "missed",
      finishedAt: now.toISOString(),
    };
    jobs.push(skipped);
    appendAudit(dataDir, { jobId: id, decision: "skip", reason: "missed" });
    return;
  }
  const today = zonedParts(now, channel.schedule.timezone);
  const dueParts = zonedParts(due, channel.schedule.timezone);
  const sameDay = today.year === dueParts.year && today.month === dueParts.month && today.day === dueParts.day;
  const ranToday = jobs.filter((job) => {
    if (job.channelId !== channel.channel_id) return false;
    const parts = zonedParts(new Date(job.dueAt), channel.schedule.timezone);
    return parts.year === today.year && parts.month === today.month && parts.day === today.day && job.status !== "skipped";
  }).length;
  if (sameDay && ranToday >= channel.max_daily_videos) return;
  jobs.push({
    id,
    channelId: channel.channel_id,
    dueAt: due.toISOString(),
    status: "queued",
    attempts: 0,
    projectId: `proj_sched_${randomUUID()}`,
    workflowId: `wf_sched_${randomUUID()}`,
  });
  appendAudit(dataDir, { jobId: id, decision: "enqueue", dueAt: due.toISOString() });
}

export async function runSchedulerTick(input: TickInput): Promise<{ ran: string[]; skipped: string[] }> {
  const owner = input.owner ?? `tick-${process.pid}`;
  acquireSchedulerLock(input.dataDir, owner, 60_000, input.now);
  const ran: string[] = [];
  const skipped: string[] = [];
  try {
    const control = loadControl(input.dataDir);
    const state = loadState(input.dataDir);
    releaseStaleLeases(state.jobs, input.now);
    for (const channel of input.channels) enqueue(input.dataDir, state.jobs, channel, input.now);
    saveState(input.dataDir, state);

    const queued = state.jobs.filter((job) => job.status === "queued").slice(0, Math.max(1, input.config.maxConcurrentJobs));
    for (const job of queued) {
      const channel = input.channels.find((item) => item.channel_id === job.channelId);
      if (!channel) {
        job.status = "skipped";
        job.lastError = "channel_missing";
        skipped.push(job.id);
        continue;
      }
      const skip = await skipReason(input, control, channel);
      if (skip) {
        job.status = "skipped";
        job.lastError = skip;
        job.finishedAt = input.now.toISOString();
        skipped.push(job.id);
        appendAudit(input.dataDir, { jobId: job.id, decision: "skip", reason: skip });
        continue;
      }
      job.status = "leased";
      job.leaseOwner = owner;
      job.leaseExpiresAt = new Date(input.now.getTime() + 15 * 60_000).toISOString();
      job.attempts += 1;
      saveState(input.dataDir, state);
      const dryRun = !livePublishingEnabled(input.config, input.dataDir);
      try {
        const result = await input.execute(job, channel, { dryRun });
        if (result.state === "FAILED" || result.error) {
          job.status = job.attempts >= input.config.maxRetries ? "failed" : "queued";
          job.lastError = result.error ?? result.state;
          if (job.status === "queued") {
            job.leaseOwner = undefined;
            job.leaseExpiresAt = undefined;
          }
          appendAudit(input.dataDir, { jobId: job.id, decision: job.status, reason: job.lastError });
        } else {
          job.status = "succeeded";
          job.finishedAt = new Date().toISOString();
          job.lastError = undefined;
          ran.push(job.id);
          appendAudit(input.dataDir, { jobId: job.id, decision: "succeeded", dryRun });
        }
      } catch (error) {
        const retryable = error instanceof ToonForgeError ? error.retryable : false;
        job.lastError = error instanceof Error ? error.message : String(error);
        job.status = retryable && job.attempts < input.config.maxRetries ? "queued" : "failed";
        if (job.status === "queued") {
          job.leaseOwner = undefined;
          job.leaseExpiresAt = undefined;
        }
        appendAudit(input.dataDir, { jobId: job.id, decision: job.status, reason: job.lastError });
      }
      saveState(input.dataDir, state);
    }
    saveState(input.dataDir, state);
    return { ran, skipped };
  } finally {
    releaseSchedulerLock(input.dataDir, owner);
  }
}

async function skipReason(
  input: TickInput,
  control: { globalPaused: boolean; pausedChannels: string[] },
  channel: ChannelConfig,
): Promise<string | null> {
  if (input.config.killSwitch) return "kill_switch";
  if (control.globalPaused) return "global_paused";
  if (control.pausedChannels.includes(channel.channel_id)) return "channel_paused";
  if (!channel.schedule.enabled) return "channel_disabled";
  const live = livePublishingEnabled(input.config, input.dataDir);
  const backend = channel.production_backend ?? "offline_fixture";
  if (live && backend === "offline_fixture") return "fixture_not_production";
  if (input.backendReady) {
    const ready = await input.backendReady(channel);
    if (!ready.ok) return ready.detail;
  }
  return null;
}

export function pauseGlobal(dataDir: string): void {
  const control = loadControl(dataDir);
  control.globalPaused = true;
  saveControl(dataDir, control);
  appendAudit(dataDir, { decision: "pause", scope: "global" });
}

export function resumeGlobal(dataDir: string): void {
  const control = loadControl(dataDir);
  control.globalPaused = false;
  saveControl(dataDir, control);
  appendAudit(dataDir, { decision: "resume", scope: "global" });
}

export function pauseChannel(dataDir: string, channelId: string): void {
  const control = loadControl(dataDir);
  if (!control.pausedChannels.includes(channelId)) control.pausedChannels.push(channelId);
  saveControl(dataDir, control);
  appendAudit(dataDir, { decision: "pause", channelId });
}

export function resumeChannel(dataDir: string, channelId: string): void {
  const control = loadControl(dataDir);
  control.pausedChannels = control.pausedChannels.filter((id) => id !== channelId);
  saveControl(dataDir, control);
  appendAudit(dataDir, { decision: "resume", channelId });
}

export function schedulerStatus(dataDir: string) {
  const control = loadControl(dataDir);
  const state = loadState(dataDir);
  return {
    globalPaused: control.globalPaused,
    pausedChannels: control.pausedChannels,
    jobs: state.jobs.slice(-20),
  };
}
