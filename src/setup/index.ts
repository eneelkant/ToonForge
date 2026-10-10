import { copyFileSync, existsSync, mkdirSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { resolveBundled } from "../core/paths.js";
import { dependencyExitCode, evaluateDependencies, type DependencyCheck } from "./dependencies.js";
import {
  chatgptRemoteExample,
  claudeCodeConfig,
  clientTargetPath,
  cursorConfig,
  geminiConfig,
  toonforgeStdioServer,
  writeIfAbsentOrMerge,
  type ClientName,
} from "./clients.js";

export interface SetupOptions {
  home: string;
  platform: NodeJS.Platform;
  client?: ClientName;
  apply: boolean;
  nonInteractive: boolean;
  command?: string;
  dataDir?: string;
}

export interface SetupReport {
  exitCode: number;
  checks: DependencyCheck[];
  dataDir: string;
  configCreated: boolean;
  client?: { name: ClientName; path: string | null; action: "preview" | "created" | "updated" | "remote-only"; body: string };
  disk?: { path: string; freeBytes: number };
}

export async function runSetup(options: SetupOptions): Promise<SetupReport> {
  const checks = await evaluateDependencies({ platform: options.platform });
  const dataDir = options.dataDir ?? join(options.home, ".toonforge");
  mkdirSync(dataDir, { recursive: true });
  const configPath = join(dataDir, "config.env");
  let configCreated = false;
  if (!existsSync(configPath)) {
    const template = resolveBundled(".env.example");
    if (existsSync(template)) {
      copyFileSync(template, configPath);
      configCreated = true;
    }
  }
  let disk: SetupReport["disk"];
  try {
    const stats = statfsSync(dataDir);
    disk = { path: dataDir, freeBytes: Number(stats.bavail) * Number(stats.bsize) };
  } catch {
    disk = undefined;
  }
  const report: SetupReport = {
    exitCode: dependencyExitCode(checks),
    checks,
    dataDir,
    configCreated,
    disk,
  };
  if (!options.client) return report;
  const server = toonforgeStdioServer(options.command ?? "toonforge");
  if (options.client === "chatgpt") {
    report.client = {
      name: "chatgpt",
      path: null,
      action: "remote-only",
      body: chatgptRemoteExample("https://your-host.example/mcp"),
    };
    return report;
  }
  const target = clientTargetPath(options.client, options.home, options.platform);
  const preview =
    options.client === "gemini"
      ? geminiConfig(server)
      : options.client === "claude"
        ? claudeCodeConfig(server)
        : cursorConfig(server);
  if (!options.apply || !target) {
    report.client = { name: options.client, path: target, action: "preview", body: preview };
    return report;
  }
  const written = writeIfAbsentOrMerge(target, server);
  report.client = { name: options.client, path: written.path, action: written.action, body: preview };
  return report;
}
