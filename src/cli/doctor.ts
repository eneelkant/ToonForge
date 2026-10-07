import { access, constants } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadRuntimeConfig } from "../core/config.js";
import { getSystemStatus } from "../mcp/tools/system.js";

const execFileAsync = promisify(execFile);

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
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
    ok: Boolean(nodePath),
    detail: nodePath ? await version("node", ["-v"]) : "not found (need >= 22.18)",
  });

  const python = await which("python3");
  checks.push({
    name: "python3",
    ok: Boolean(python),
    detail: python ? await version("python3", ["--version"]) : "not found",
  });

  const ffmpeg = await which("ffmpeg");
  checks.push({
    name: "ffmpeg",
    ok: Boolean(ffmpeg),
    detail: ffmpeg ? await version("ffmpeg", ["-version"]) : "not found",
  });

  const git = await which("git");
  checks.push({
    name: "git",
    ok: Boolean(git),
    detail: git ? await version("git", ["--version"]) : "not found",
  });

  const gh = await which("gh");
  checks.push({
    name: "gh",
    ok: Boolean(gh),
    detail: gh ? await version("gh", ["--version"]) : "optional; not found",
  });

  const writableDirs = ["data", "logs", "generated", "published", "projects", "analytics"];
  for (const dir of writableDirs) {
    const abs = resolve(dir);
    try {
      await access(abs, constants.W_OK);
      checks.push({ name: `writable:${dir}`, ok: true, detail: abs });
    } catch {
      checks.push({
        name: `writable:${dir}`,
        ok: false,
        detail: `${abs} missing or not writable (create with mkdir -p)`,
      });
    }
  }

  const config = loadRuntimeConfig();
  const status = await getSystemStatus(config);
  checks.push({
    name: "kill_switch",
    ok: !status.killSwitch,
    detail: status.killSwitch ? "ENABLED — all irreversible work blocked" : "disabled",
  });
  checks.push({
    name: "adapter:omnichar",
    ok: true,
    detail: JSON.stringify(status.adapters.omnichar),
  });
  checks.push({
    name: "adapter:reelmimic",
    ok: true,
    detail: JSON.stringify(status.adapters.reelmimic),
  });
  checks.push({
    name: "adapter:youtube",
    ok: true,
    detail: JSON.stringify(status.adapters.youtube),
  });
  checks.push({
    name: "adapter:orchestrator",
    ok: status.adapters.orchestrator.status === "ready",
    detail: JSON.stringify(status.adapters.orchestrator),
  });

  const failed = checks.filter((c) => !c.ok && !c.name.startsWith("adapter:"));
  for (const c of checks) {
    console.log(`${c.ok ? "OK" : "FAIL"}  ${c.name}: ${c.detail}`);
  }
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDoctor().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
