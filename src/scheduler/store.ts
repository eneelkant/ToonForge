import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { ToonForgeError } from "../core/errors.js";

export type JobStatus = "queued" | "leased" | "succeeded" | "failed" | "skipped";

export interface ScheduledJob {
  id: string;
  channelId: string;
  dueAt: string;
  status: JobStatus;
  attempts: number;
  projectId?: string;
  workflowId?: string;
  lastError?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  finishedAt?: string;
}

export interface SchedulerControl {
  globalPaused: boolean;
  pausedChannels: string[];
}

export interface SchedulerLock {
  owner: string;
  pid: number;
  expiresAt: string;
}

export interface SchedulerState {
  version: 1;
  jobs: ScheduledJob[];
}

const STATE = "state.json";
const CONTROL = "control.json";
const LOCK = "lock.json";
const AUDIT = "audit.jsonl";

export function schedulerDir(dataDir: string): string {
  return join(dataDir, "scheduler");
}

function ensure(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function loadControl(dataDir: string): SchedulerControl {
  const path = join(schedulerDir(dataDir), CONTROL);
  if (!existsSync(path)) return { globalPaused: false, pausedChannels: [] };
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SchedulerControl>;
  return {
    globalPaused: parsed.globalPaused === true,
    pausedChannels: Array.isArray(parsed.pausedChannels) ? parsed.pausedChannels.map(String) : [],
  };
}

export function saveControl(dataDir: string, control: SchedulerControl): void {
  const dir = schedulerDir(dataDir);
  ensure(dir);
  writeFileSync(join(dir, CONTROL), JSON.stringify(control, null, 2), { mode: 0o600 });
}

export function loadState(dataDir: string): SchedulerState {
  const path = join(schedulerDir(dataDir), STATE);
  if (!existsSync(path)) return { version: 1, jobs: [] };
  const parsed = JSON.parse(readFileSync(path, "utf8")) as SchedulerState;
  return { version: 1, jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] };
}

export function saveState(dataDir: string, state: SchedulerState): void {
  const dir = schedulerDir(dataDir);
  ensure(dir);
  writeFileSync(join(dir, STATE), JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function appendAudit(dataDir: string, event: Record<string, unknown>): void {
  const dir = schedulerDir(dataDir);
  ensure(dir);
  appendFileSync(join(dir, AUDIT), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
}

export function acquireSchedulerLock(dataDir: string, owner: string, ttlMs: number, now = new Date()): void {
  const dir = schedulerDir(dataDir);
  ensure(dir);
  const path = join(dir, LOCK);
  const payload: SchedulerLock = {
    owner,
    pid: process.pid,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
  try {
    writeFileSync(path, JSON.stringify(payload), { flag: "wx", mode: 0o600 });
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
  }
  const current = JSON.parse(readFileSync(path, "utf8")) as SchedulerLock;
  if (Date.parse(current.expiresAt) > now.getTime()) {
    throw new ToonForgeError({
      code: "DUPLICATE",
      message: "Another scheduler holds the lock",
      component: "scheduler.lock",
      context: { owner: current.owner, expiresAt: current.expiresAt },
    });
  }
  unlinkSync(path);
  writeFileSync(path, JSON.stringify(payload), { flag: "wx", mode: 0o600 });
}

export function releaseSchedulerLock(dataDir: string, owner: string): void {
  const path = join(schedulerDir(dataDir), LOCK);
  if (!existsSync(path)) return;
  const current = JSON.parse(readFileSync(path, "utf8")) as SchedulerLock;
  if (current.owner !== owner) return;
  unlinkSync(path);
}

export function readLock(dataDir: string): SchedulerLock | null {
  const path = join(schedulerDir(dataDir), LOCK);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as SchedulerLock;
}
