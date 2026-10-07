import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface AnalyticsSnapshot {
  videoId: string;
  projectId?: string;
  capturedAt: string;
  impressions?: number;
  views?: number;
  ctr?: number;
  averageViewDuration?: number;
  retention?: number;
  likes?: number;
  comments?: number;
  subscribers?: number;
  trafficSource?: string;
  publishingTime?: string;
  topic?: string;
  hook?: string;
  duration?: number;
  characters?: string[];
  style?: string;
  simulated?: boolean;
}

export interface LearningRecommendation {
  id: string;
  kind: "hook" | "duration" | "character" | "topic" | "window";
  summary: string;
  confidence: number;
  status: "pending" | "approved" | "rejected";
  evidence: string[];
}

export function ingestAnalytics(dataDir: string, snap: AnalyticsSnapshot): string {
  const dir = join(dataDir, "analytics");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${snap.videoId}-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(snap, null, 2));
  return path;
}

export function loadAnalytics(dataDir: string): AnalyticsSnapshot[] {
  const dir = join(dataDir, "analytics");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as AnalyticsSnapshot);
}

/** Controlled recommendations — never auto-applied to safety policy. */
export function recommendFromAnalytics(snaps: AnalyticsSnapshot[]): LearningRecommendation[] {
  const real = snaps.filter((s) => !s.simulated);
  if (real.length === 0) {
    return [
      {
        id: "learn_pending_data",
        kind: "topic",
        summary: "Insufficient real analytics; keep current strategy",
        confidence: 0.1,
        status: "pending",
        evidence: ["no non-simulated snapshots"],
      },
    ];
  }
  const byHook = new Map<string, number[]>();
  for (const s of real) {
    if (!s.hook || s.ctr == null) continue;
    const arr = byHook.get(s.hook) ?? [];
    arr.push(s.ctr);
    byHook.set(s.hook, arr);
  }
  const recs: LearningRecommendation[] = [];
  for (const [hook, ctrs] of byHook) {
    const avg = ctrs.reduce((a, b) => a + b, 0) / ctrs.length;
    recs.push({
      id: `hook_${hook.slice(0, 24)}`,
      kind: "hook",
      summary: `Hook "${hook}" average CTR ${avg.toFixed(3)}`,
      confidence: Math.min(0.9, 0.3 + ctrs.length * 0.1),
      status: "pending",
      evidence: [`n=${ctrs.length}`],
    });
  }
  return recs;
}
