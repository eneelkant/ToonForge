import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveBundled } from "../core/paths.js";

const execFileAsync = promisify(execFile);

export interface DependencySpec {
  id: string;
  required: boolean;
  platforms: Array<"darwin" | "linux" | "win32">;
  versionRange?: string;
  detect: { command: string; args: string[] };
  why: string;
  license: string;
  disk?: string;
  install: Record<string, string>;
}

export interface DependencyCheck {
  id: string;
  required: boolean;
  status: "pass" | "missing" | "unsupported" | "outdated";
  detail: string;
  why: string;
  install: string;
  license: string;
}

export type CommandRunner = (command: string, args: string[]) => Promise<{ ok: boolean; output: string }>;

export function loadDependencyManifest(path = resolveBundled("config/dependencies.json")): DependencySpec[] {
  return JSON.parse(readFileSync(path, "utf8")) as DependencySpec[];
}

export function defaultCommandRunner(): CommandRunner {
  return async (command, args) => {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, { timeout: 10_000 });
      return { ok: true, output: `${stdout}${stderr}`.trim() };
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, output: `${failed.stdout ?? ""}${failed.stderr ?? failed.message ?? ""}`.trim() };
    }
  };
}

export function versionSatisfies(actual: string, range: string | undefined): boolean {
  if (!range) return true;
  const match = range.match(/^>=(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return true;
  const found = actual.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!found) return false;
  const got = [Number(found[1]), Number(found[2]), Number(found[3])];
  const need = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let i = 0; i < 3; i += 1) {
    if ((got[i] ?? 0) > (need[i] ?? 0)) return true;
    if ((got[i] ?? 0) < (need[i] ?? 0)) return false;
  }
  return true;
}

export async function evaluateDependencies(input: {
  platform: NodeJS.Platform;
  specs?: DependencySpec[];
  run?: CommandRunner;
}): Promise<DependencyCheck[]> {
  const specs = input.specs ?? loadDependencyManifest();
  const run = input.run ?? defaultCommandRunner();
  const checks: DependencyCheck[] = [];
  for (const spec of specs) {
    const install = spec.install[input.platform] ?? spec.install.linux ?? "See the dependency documentation.";
    if (!spec.platforms.includes(input.platform as DependencySpec["platforms"][number])) {
      checks.push({
        id: spec.id,
        required: spec.required,
        status: "unsupported",
        detail: `${input.platform} is not a supported platform for ${spec.id}`,
        why: spec.why,
        install,
        license: spec.license,
      });
      continue;
    }
    const result = await run(spec.detect.command, spec.detect.args);
    if (!result.ok) {
      checks.push({
        id: spec.id,
        required: spec.required,
        status: "missing",
        detail: result.output || "not found",
        why: spec.why,
        install,
        license: spec.license,
      });
      continue;
    }
    if (!versionSatisfies(result.output, spec.versionRange)) {
      checks.push({
        id: spec.id,
        required: spec.required,
        status: "outdated",
        detail: result.output.split("\n")[0] ?? result.output,
        why: spec.why,
        install,
        license: spec.license,
      });
      continue;
    }
    checks.push({
      id: spec.id,
      required: spec.required,
      status: "pass",
      detail: (result.output.split("\n")[0] ?? result.output).slice(0, 180),
      why: spec.why,
      install,
      license: spec.license,
    });
  }
  return checks;
}

export function dependencyExitCode(checks: DependencyCheck[]): number {
  return checks.some((check) => check.required && check.status !== "pass") ? 2 : 0;
}
