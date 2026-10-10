import { access, constants } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadRuntimeConfig } from "../core/config.js";
import { getSystemStatus } from "../mcp/tools/system.js";

const execFileAsync = promisify(execFile);

type Severity = "PASS" | "WARN" | "FAIL";

interface CheckResult {
  name: string;
  severity: Severity;
  detail: string;
  remediation?: string;
}

async function which(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("bash", ["-lc", `command -v ${cmd}`]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function version(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args);
    return (stdout || stderr).trim().split("\n")[0] ?? "unknown";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function runDoctor(): Promise<void> {
  const checks: CheckResult[] = [];
  const nodePath = await which("node");
  checks.push({
    name: "node",
    severity: nodePath ? "PASS" : "FAIL",
    detail: nodePath ? await version("node", ["-v"]) : "not found",
    remediation: "Install Node.js >= 22.14",
  });

  const python = await which("python3");
  checks.push({
    name: "python3",
    severity: python ? "PASS" : "WARN",
    detail: python ? await version("python3", ["--version"]) : "not found",
    remediation: "Needed for ReelMimic analyze.py / OmniChar",
  });

  const ffmpeg = await which("ffmpeg");
  const ffprobeBin = await which("ffprobe");
  checks.push({
    name: "ffmpeg",
    severity: ffmpeg ? "PASS" : "FAIL",
    detail: ffmpeg ? await version("ffmpeg", ["-version"]) : "not found",
    remediation: "Install FFmpeg — required for media generation and validation",
  });
  checks.push({
    name: "ffprobe",
    severity: ffprobeBin ? "PASS" : "FAIL",
    detail: ffprobeBin ? await version("ffprobe", ["-version"]) : "not found",
    remediation: "Install ffprobe (usually bundled with FFmpeg)",
  });

  const git = await which("git");
  checks.push({
    name: "git",
    severity: git ? "PASS" : "WARN",
    detail: git ? await version("git", ["--version"]) : "not found",
  });

  const gh = await which("gh");
  checks.push({
    name: "gh",
    severity: gh ? "PASS" : "WARN",
    detail: gh ? await version("gh", ["--version"]) : "optional; not found",
  });

  const docker = await which("docker");
  checks.push({
    name: "docker",
    severity: docker ? "PASS" : "WARN",
    detail: docker ? await version("docker", ["--version"]) : "optional; not found",
  });

  const writableDirs = ["data", "logs", "generated", "published", "projects", "analytics"];
  for (const dir of writableDirs) {
    const abs = resolve(dir);
    try {
      await access(abs, constants.W_OK);
      checks.push({ name: `writable:${dir}`, severity: "PASS", detail: abs });
    } catch {
      checks.push({
        name: `writable:${dir}`,
        severity: "FAIL",
        detail: `${abs} missing or not writable`,
        remediation: `mkdir -p ${dir}`,
      });
    }
  }

  const config = loadRuntimeConfig();
  const status = await getSystemStatus(config);
  checks.push({
    name: "kill_switch",
    severity: status.killSwitch ? "FAIL" : "PASS",
    detail: status.killSwitch ? "ENABLED — irreversible work blocked" : "disabled",
    remediation: "Set TOONFORGE_KILL_SWITCH=false to resume",
  });

  const adapterSeverity = (s: string): Severity =>
    s === "ready" ? "PASS" : s === "disabled" ? "WARN" : "WARN";

  checks.push({
    name: "adapter:omnichar",
    severity: adapterSeverity(status.adapters.omnichar.status),
    detail: JSON.stringify(status.adapters.omnichar),
    remediation: "Install OmniChar and set OMNICHAR_ENABLED=true",
  });
  checks.push({
    name: "adapter:reelmimic",
    severity: adapterSeverity(status.adapters.reelmimic.status),
    detail: JSON.stringify(status.adapters.reelmimic),
    remediation: "Install ReelMimic and set REELMIMIC_ENABLED=true",
  });
  checks.push({
    name: "adapter:youtube",
    severity: status.adapters.youtube.status === "ready" ? "PASS" : "WARN",
    detail: JSON.stringify(status.adapters.youtube),
    remediation: "Configure YOUTUBE_CLIENT_ID/SECRET and OAuth token",
  });
  const openmontageHealth = status.adapters.openmontageHealth;
  checks.push({
    name: "adapter:openmontage",
    severity: openmontageHealth?.status === "ready" ? "PASS" : "WARN",
    detail: openmontageHealth
      ? `${openmontageHealth.status}: ${openmontageHealth.detail}`
      : JSON.stringify(status.adapters.openmontage),
    remediation:
      "Optional. Install OpenMontage separately, then set OPENMONTAGE_ENABLED=true and OPENMONTAGE_ROOT to that checkout. Do not vendor its AGPL source.",
  });
  checks.push({
    name: "adapter:orchestrator",
    severity: status.adapters.orchestrator.status === "ready" ? "PASS" : "WARN",
    detail: JSON.stringify(status.adapters.orchestrator),
  });

  const ytTrends = config.youtubeTrends;
  if (!ytTrends.enabled) {
    checks.push({
      name: "provider:youtube-trends",
      severity: "WARN",
      detail: "disabled (TOONFORGE_YOUTUBE_TRENDS_ENABLED is not true)",
      remediation: "Set TOONFORGE_YOUTUBE_TRENDS_ENABLED=true and YOUTUBE_DATA_API_KEY for live trends",
    });
  } else if (!ytTrends.apiKey) {
    checks.push({
      name: "provider:youtube-trends",
      severity: "WARN",
      detail: "enabled but YOUTUBE_DATA_API_KEY is not configured",
      remediation: "Set YOUTUBE_DATA_API_KEY (Data API key — separate from OAuth publish credentials)",
    });
  } else {
    checks.push({
      name: "provider:youtube-trends",
      severity: "PASS",
      detail: `configured region=${ytTrends.regionCode} maxResults=${ytTrends.maxResults} key=present`,
    });
  }

  let fail = 0;
  let warn = 0;
  for (const c of checks) {
    console.log(`${c.severity.padEnd(4)} ${c.name}: ${c.detail}`);
    if (c.severity === "FAIL" && c.remediation) console.log(`      → ${c.remediation}`);
    if (c.severity === "WARN" && c.remediation) console.log(`      → ${c.remediation}`);
    if (c.severity === "FAIL") fail += 1;
    if (c.severity === "WARN") warn += 1;
  }
  console.log(`SUMMARY fail=${fail} warn=${warn} pass=${checks.length - fail - warn}`);
  if (fail > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDoctor().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
