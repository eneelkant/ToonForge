import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenMontageAdapter } from "../../src/adapters/openmontage/types.js";
import { runDailyWorkflow } from "../../src/engines/workflow/daily.js";
import { publicErrorText, workflowProcessCode } from "../../src/engines/workflow/result.js";
import { toolCallResponse } from "../../src/mcp/server.js";

function mp4Files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...mp4Files(path));
    else if (entry.name.endsWith(".mp4")) found.push(path);
  }
  return found;
}

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli/index.ts", ...args], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

describe("workflow failure status", () => {
  it("redacts credential-shaped text and maps a failed workflow to a tool error", () => {
    const secret = "client_secret=GOCSPX-notarealsecret";
    const redacted = publicErrorText(`OpenMontage failed ${secret} Bearer ya29.fake-access-token`);
    expect(redacted).not.toContain("GOCSPX-");
    expect(redacted).not.toContain("ya29.");
    expect(redacted).toContain("[redacted]");
    expect(workflowProcessCode({ state: "COMPLETE" })).toBe(0);
    expect(workflowProcessCode({ state: "FAILED" })).toBe(1);

    const response = toolCallResponse("toonforge.run_daily_workflow", {
      state: "FAILED",
      error: `provider down ${secret}`,
    });
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).not.toContain("GOCSPX-");
    expect(toolCallResponse("toonforge.run_daily_workflow", { state: "COMPLETE" }).isError).toBeUndefined();
  });

  it("records a provider failure without a fixture video", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-wf-fail-"));
    const openmontage = {
      async health() {
        return {
          status: "health_check_failed" as const,
          detail: "probe failed client_secret=GOCSPX-notarealsecret",
        };
      },
    } as OpenMontageAdapter;
    const result = await runDailyWorkflow({
      dryRun: true,
      dataDir,
      pipelineMode: "openmontage",
      openmontage,
    });
    expect(result.state).toBe("FAILED");
    expect(result.qa.verdict).toBe("FAIL");
    expect(result.error).toMatch(/health_check_failed/);
    expect(result.error).not.toContain("GOCSPX-");
    expect(result.error).not.toContain("notarealsecret");
    expect(result.artifacts.videoPath).toBeUndefined();
    expect(mp4Files(join(dataDir, "projects", result.projectId))).toEqual([]);
    expect(workflowProcessCode(result)).toBe(1);
  });

  it("returns a nonzero process status when OpenMontage cannot run", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-cli-fail-"));
    const env = {
      ...process.env,
      TOONFORGE_DATA_DIR: dataDir,
      TOONFORGE_KILL_SWITCH: "false",
      OPENMONTAGE_ENABLED: "false",
      YOUTUBE_DRY_RUN: "true",
    };
    const failed = await runCli(["workflow", "run", "daily", "--pipeline", "openmontage"], env);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toMatch(/workflow failed:/);
    const body = JSON.parse(failed.stdout) as { state: string; error?: string };
    expect(body.state).toBe("FAILED");
    expect(body.error).toMatch(/OpenMontage/);
    expect(mp4Files(join(dataDir, "projects"))).toEqual([]);
  }, 60_000);

  it("returns process status 0 for a successful offline dry-run", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-cli-ok-"));
    const env = {
      ...process.env,
      TOONFORGE_DATA_DIR: dataDir,
      TOONFORGE_KILL_SWITCH: "false",
      OPENMONTAGE_ENABLED: "false",
      YOUTUBE_DRY_RUN: "true",
    };
    const ok = await runCli(["workflow", "run", "daily", "--pipeline", "offline_fixture"], env);
    expect(ok.code).toBe(0);
    expect(ok.stderr).not.toMatch(/workflow failed:/);
    const body = JSON.parse(ok.stdout) as { state: string };
    expect(body.state).toBe("COMPLETE");
  }, 60_000);
});
