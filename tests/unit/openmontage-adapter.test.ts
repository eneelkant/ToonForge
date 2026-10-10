import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultCharacterRegistry } from "../../src/characters/registry.js";
import type { CharacterRecord } from "../../src/characters/types.js";
import { loadRuntimeConfig, assertNotKilled } from "../../src/core/config.js";
import { ToonForgeError } from "../../src/core/errors.js";
import { isProductionMediaKind } from "../../src/core/media.js";
import { handleTool } from "../../src/mcp/handlers.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import {
  createOpenMontageAdapter,
  mapCharactersToOpenMontage,
  openMontageSlug,
} from "../../src/adapters/openmontage/index.js";
import { assertInsideWorkspace } from "../../src/adapters/openmontage/client.js";
import { sanitizeProcessText } from "../../src/adapters/openmontage/errors.js";
import type { ProcessRunner } from "../../src/adapters/openmontage/types.js";
import { produceCartoon } from "../../src/engines/production/index.js";
import { resolvePipelineMode } from "../../src/engines/reference/index.js";
import { generateDevVideo } from "../../src/core/media.js";
import { createStoryboard } from "../../src/engines/storyboard/index.js";
import type { OriginalStory } from "../../src/engines/story/index.js";
import type { OpenMontageAdapter } from "../../src/adapters/openmontage/types.js";

function tempCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), "om-root-"));
  for (const rel of [
    "tools/character/character_animation.py",
    "tools/tool_registry.py",
    "pipeline_defs/character-animation.yaml",
    "LICENSE",
  ]) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "marker");
  }
  return root;
}

function story(): OriginalStory {
  return {
    story_id: "story_test",
    title: "Bolt learns a new trick",
    logline: "An original short.",
    hook: "hook",
    synopsis: "Max and Bolt solve an original problem.",
    characters: ["max", "bolt"],
    scenes: [],
    narration: "narration",
    dialogue: [],
    duration_target: 12,
    format: "shorts",
    originality_notes: ["original"],
    risk_flags: [],
    version: "1.0.0",
    script_hash: "abc",
  };
}

describe("OpenMontage configuration and selection", () => {
  it("stays disabled unless OPENMONTAGE_ENABLED=true", () => {
    const cfg = loadRuntimeConfig({});
    expect(cfg.openmontage.enabled).toBe(false);
    expect(cfg.openmontage.python).toBe("python3");
    expect(cfg.openmontage.timeoutMs).toBe(120_000);
  });

  it("does not select OpenMontage just because it is enabled", () => {
    expect(resolvePipelineMode({ reelmimicEnabled: false, openmontageEnabled: true })).toBe("offline_fixture");
    expect(resolvePipelineMode({ reelmimicEnabled: true, openmontageEnabled: true })).toBe("reelmimic");
    expect(
      resolvePipelineMode({
        reelmimicEnabled: true,
        openmontageEnabled: true,
        channelBackend: "openmontage",
      }),
    ).toBe("openmontage");
    expect(
      resolvePipelineMode({
        reelmimicEnabled: false,
        mode: "reelmimic",
        channelBackend: "openmontage",
      }),
    ).toBe("reelmimic");
    expect(resolvePipelineMode({ reelmimicEnabled: false, mode: "offline_fixture" })).toBe("offline_fixture");
  });
});

describe("OpenMontage character mapping", () => {
  it("preserves identity and rejects ids the upstream slug would rewrite", async () => {
    const records = await defaultCharacterRegistry().list();
    const mapped = mapCharactersToOpenMontage(records);
    expect(mapped.characters.map((c) => c.id)).toEqual(records.map((c) => c.character_id));
    expect(mapped.characters.map((c) => c.display_name)).toEqual(records.map((c) => c.display_name));
    for (const record of records) {
      const spec = mapped.characters.find((c) => c.id === record.character_id);
      expect(spec?.body_type).toBe(record.canonical_description);
      expect(spec?.silhouette_notes).toBe(record.canonical_description);
      expect(spec?.props).toEqual(record.wardrobe);
      expect(spec?.required_emotions).toEqual(record.personality);
    }
    expect(mapped.preservedLocally.every((item) => item.fields.includes("voice"))).toBe(true);
    expect(openMontageSlug("Max")).toBe("max");
    const bad = { ...records[0]!, character_id: "Max" };
    expect(() => mapCharactersToOpenMontage([bad])).toThrow(/rewritten/);
  });

  it("returns a structured compatibility error when identity fields are missing", async () => {
    const [record] = await defaultCharacterRegistry().list();
    const broken = { ...record!, canonical_description: "", allowed_styles: [] } as CharacterRecord;
    try {
      mapCharactersToOpenMontage([broken]);
      throw new Error("expected compatibility failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ToonForgeError);
      const typed = error as ToonForgeError;
      expect(typed.context.errorClass).toBe("compatibility");
      expect(typed.context.missing).toEqual(expect.arrayContaining(["canonical_description", "allowed_styles"]));
    }
  });
});

describe("OpenMontage process adapter", () => {
  it("reports disabled without spawning", async () => {
    let called = false;
    const adapter = createOpenMontageAdapter(loadRuntimeConfig({}).openmontage, {
      run: async () => {
        called = true;
        throw new Error("should not spawn");
      },
    });
    expect(await adapter.health()).toMatchObject({ status: "disabled" });
    expect(called).toBe(false);
  });

  it("reports not installed, invalid configuration, missing dependencies, and health-check failure", async () => {
    const missing = createOpenMontageAdapter(
      loadRuntimeConfig({ OPENMONTAGE_ENABLED: "true", OPENMONTAGE_ROOT: join(tmpdir(), "om-does-not-exist") }).openmontage,
      { run: async () => { throw new Error("no"); } },
    );
    expect((await missing.health()).status).toBe("not_installed");

    const invalid = createOpenMontageAdapter(
      loadRuntimeConfig({ OPENMONTAGE_ENABLED: "true", OPENMONTAGE_ROOT: "relative/path" }).openmontage,
      { run: async () => { throw new Error("no"); } },
    );
    expect((await invalid.health()).status).toBe("invalid_configuration");

    const root = tempCheckout();
    const deps = createOpenMontageAdapter(
      loadRuntimeConfig({ OPENMONTAGE_ENABLED: "true", OPENMONTAGE_ROOT: root, OPENMONTAGE_PYTHON: "python3" }).openmontage,
      {
        run: async () => ({
          code: 1,
          stdout: JSON.stringify({ ok: false, error_class: "missing_dependencies", message: "No module named jsonschema" }),
          stderr: "",
          durationMs: 5,
          timedOut: false,
        }),
      },
    );
    expect((await deps.health()).status).toBe("missing_dependencies");

    const sick = createOpenMontageAdapter(
      loadRuntimeConfig({ OPENMONTAGE_ENABLED: "true", OPENMONTAGE_ROOT: root }).openmontage,
      {
        run: async () => ({
          code: 1,
          stdout: JSON.stringify({ ok: false, error_class: "health_check_failed", message: "boom" }),
          stderr: "token=super-secret",
          durationMs: 5,
          timedOut: false,
        }),
      },
    );
    const health = await sick.health();
    expect(health.status).toBe("health_check_failed");
    expect(JSON.stringify(health)).not.toContain("super-secret");
  });

  it("builds an argv array and refuses escaped output paths", async () => {
    const root = tempCheckout();
    const workspace = mkdtempSync(join(tmpdir(), "om-work-"));
    const calls: Array<{ command: string; args: string[]; input: string }> = [];
    const run: ProcessRunner = async (request) => {
      calls.push({ command: request.command, args: request.args, input: request.input });
      const body = JSON.parse(request.input) as { characters: Array<{ id: string; display_name: string }>; video_output_path: string };
      expect(request.args).toHaveLength(1);
      expect(request.args[0]).toContain("openmontage_runner.py");
      expect(request.command).toBe("python3");
      expect(request.input).not.toMatch(/sk-|api[_-]?key/i);
      writeFileSync(body.video_output_path, "placeholder-bytes");
      return {
        code: 0,
        stdout: JSON.stringify({
          ok: true,
          versions: { character_rig_renderer: "0.1.0" },
          video_path: body.video_output_path,
          character_ids: body.characters.map((c) => c.id),
          display_names: body.characters.map((c) => c.display_name),
          artifacts: [body.video_output_path],
          cost_usd: 0,
          approval: { agent_pipeline: "not_invoked", detail: "not simulated" },
        }),
        stderr: "",
        durationMs: 4,
        timedOut: false,
      };
    };
    const characters = await defaultCharacterRegistry().list();
    const adapter = createOpenMontageAdapter(
      loadRuntimeConfig({ OPENMONTAGE_ENABLED: "true", OPENMONTAGE_ROOT: root, OPENMONTAGE_PYTHON: "python3" }).openmontage,
      { run },
    );
    const rendered = await adapter.renderCharacterAnimation({
      workspace,
      characters,
      storyboard: {
        storyboard_id: "sb",
        story_id: "story_test",
        version: "1.0.0",
        shots: [
          {
            shot_id: "shot_001",
            scene_id: "scene-1",
            order: 1,
            duration_seconds: 2,
            camera: "static",
            framing: "medium",
            characters: ["max"],
            dialogue: "",
            narration: "hello",
            visual: "Max waves",
            transition: "cut",
            audio_cues: [],
          },
        ],
      },
      brief: "original short",
      durationSeconds: 2,
    });
    expect(rendered.characterIds).toEqual(characters.map((c) => c.character_id));
    expect(rendered.approval.agentPipeline).toBe("not_invoked");
    expect(calls).toHaveLength(1);

    expect(() => assertInsideWorkspace(workspace, resolve(workspace, "../escape.mp4"))).toThrow(/outside the project workspace/);
  });

  it("classifies timeout, process failure, and missing artifacts", async () => {
    const root = tempCheckout();
    const config = loadRuntimeConfig({
      OPENMONTAGE_ENABLED: "true",
      OPENMONTAGE_ROOT: root,
      OPENMONTAGE_MAX_RETRIES: "1",
    }).openmontage;
    const characters = (await defaultCharacterRegistry().list()).slice(0, 1);
    const board = {
      storyboard_id: "sb",
      story_id: "story_test",
      version: "1.0.0",
      shots: [
        {
          shot_id: "shot_001",
          scene_id: "scene-1",
          order: 1,
          duration_seconds: 2,
          camera: "static",
          framing: "medium",
          characters: ["max"],
          dialogue: "",
          narration: "",
          visual: "wave",
          transition: "cut",
          audio_cues: [],
        },
      ],
    };
    const timeout = createOpenMontageAdapter(config, {
      run: async () => ({ code: 1, stdout: "", stderr: "api_key=sekret", durationMs: 10, timedOut: true }),
    });
    await expect(
      timeout.renderCharacterAnimation({ workspace: mkdtempSync(join(tmpdir(), "om-t-")), characters, storyboard: board, brief: "b", durationSeconds: 2 }),
    ).rejects.toMatchObject({ context: { errorClass: "timeout" } });

    const crashed = createOpenMontageAdapter(config, {
      run: async () => ({ code: 1, stdout: "", stderr: "token=sekret exploded", durationMs: 3, timedOut: false }),
    });
    try {
      await crashed.renderCharacterAnimation({
        workspace: mkdtempSync(join(tmpdir(), "om-c-")),
        characters,
        storyboard: board,
        brief: "b",
        durationSeconds: 2,
      });
      throw new Error("expected failure");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("sekret");
      expect(JSON.stringify(error)).not.toContain("sekret");
    }

    const empty = createOpenMontageAdapter(config, {
      run: async () => ({
        code: 0,
        stdout: JSON.stringify({ ok: true, character_ids: ["max"], display_names: ["Max"] }),
        stderr: "",
        durationMs: 1,
        timedOut: false,
      }),
    });
    await expect(
      empty.renderCharacterAnimation({ workspace: mkdtempSync(join(tmpdir(), "om-e-")), characters, storyboard: board, brief: "b", durationSeconds: 2 }),
    ).rejects.toMatchObject({ context: { errorClass: "invalid_output" } });
  });

  it("sanitizes secrets", () => {
    expect(sanitizeProcessText("Authorization: Bearer abc.def token=hunter2")).not.toMatch(/hunter2|abc\.def/);
  });
});

describe("OpenMontage production routing", () => {
  it("does not fall back to the offline fixture when OpenMontage fails", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "om-prod-"));
    const adapter: OpenMontageAdapter = {
      name: "openmontage",
      async probe() {
        return { status: "ready" };
      },
      async health() {
        return { status: "ready", detail: "test" };
      },
      async renderCharacterAnimation() {
        throw new ToonForgeError({
          code: "UPSTREAM_ERROR",
          message: "renderer failed",
          component: "adapters.openmontage",
          context: { errorClass: "execution_failure" },
        });
      },
    };
    await expect(
      produceCartoon({
        projectId: "p1",
        projectDir,
        story: story(),
        storyboard: createStoryboard(story()),
        characters: await defaultCharacterRegistry().list(),
        openmontage: adapter,
        mode: "openmontage",
      }),
    ).rejects.toThrow(/renderer failed/);
    expect(existsSync(join(projectDir, "out", "video.mp4"))).toBe(false);
  });

  it("rejects an explicit ReelMimic selection without an adapter", async () => {
    await expect(
      produceCartoon({
        projectId: "p2",
        projectDir: mkdtempSync(join(tmpdir(), "rm-prod-")),
        story: story(),
        storyboard: createStoryboard(story()),
        mode: "reelmimic",
      }),
    ).rejects.toThrow(/ReelMimic/);
  });

  it("validates OpenMontage media and refuses a text placeholder", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "om-media-"));
    const bad: OpenMontageAdapter = {
      name: "openmontage",
      async probe() {
        return { status: "ready" };
      },
      async health() {
        return { status: "ready", detail: "test" };
      },
      async renderCharacterAnimation(input) {
        mkdirSync(input.workspace, { recursive: true });
        const videoPath = join(input.workspace, "video.mp4");
        writeFileSync(videoPath, "this is not a video");
        return {
          videoPath,
          artifactPaths: [videoPath],
          versions: { character_rig_renderer: "0.1.0" },
          characterIds: input.characters.map((c) => c.character_id),
          displayNames: input.characters.map((c) => c.display_name),
          durationMs: 1,
          retryCount: 0,
          estimatedCostUsd: 0,
          actualCostUsd: 0,
          approval: { agentPipeline: "not_invoked", detail: "test" },
        };
      },
    };
    await expect(
      produceCartoon({
        projectId: "p3",
        projectDir,
        story: story(),
        storyboard: createStoryboard(story()),
        characters: await defaultCharacterRegistry().list(),
        openmontage: bad,
        mode: "openmontage",
      }),
    ).rejects.toThrow(/validation|stub|placeholder/i);

    const projectDirOk = mkdtempSync(join(tmpdir(), "om-ok-"));
    const good: OpenMontageAdapter = {
      ...bad,
      async renderCharacterAnimation(input) {
        mkdirSync(input.workspace, { recursive: true });
        const videoPath = join(input.workspace, "video.mp4");
        await generateDevVideo({ outPath: videoPath, durationSec: 2, withAudio: false, label: "om" });
        return {
          videoPath,
          artifactPaths: [videoPath],
          versions: { character_rig_renderer: "0.1.0" },
          characterIds: input.characters.map((c) => c.character_id),
          displayNames: input.characters.map((c) => c.display_name),
          durationMs: 1,
          retryCount: 0,
          estimatedCostUsd: 0,
          actualCostUsd: 0,
          approval: { agentPipeline: "not_invoked", detail: "test" },
        };
      },
    };
    const result = await produceCartoon({
      projectId: "p4",
      projectDir: projectDirOk,
      story: story(),
      storyboard: createStoryboard(story()),
      characters: await defaultCharacterRegistry().list(),
      openmontage: good,
      mode: "openmontage",
    });
    expect(result.kind).toBe("openmontage");
    expect(result.mode).toBe("openmontage");
    const meta = JSON.parse(readFileSync(join(projectDirOk, "out", "production.json"), "utf8")) as { backend: string };
    expect(meta.backend).toBe("openmontage");
    expect(isProductionMediaKind("openmontage")).toBe(true);
    expect(isProductionMediaKind("ffmpeg_dev")).toBe(false);
  });

  it("enforces the kill switch and budget before rendering", async () => {
    const previousKill = process.env.TOONFORGE_KILL_SWITCH;
    const previousBudget = process.env.TOONFORGE_PER_VIDEO_BUDGET_USD;
    let calls = 0;
    const adapter: OpenMontageAdapter = {
      name: "openmontage",
      async probe() {
        return { status: "ready" };
      },
      async health() {
        return { status: "ready", detail: "test" };
      },
      async renderCharacterAnimation() {
        calls += 1;
        throw new Error("should not render");
      },
    };
    try {
      process.env.TOONFORGE_KILL_SWITCH = "true";
      expect(() => assertNotKilled(loadRuntimeConfig())).toThrow(/kill switch/i);
      await expect(
        produceCartoon({
          projectId: "p5",
          projectDir: mkdtempSync(join(tmpdir(), "om-kill-")),
          story: story(),
          storyboard: createStoryboard(story()),
          characters: await defaultCharacterRegistry().list(),
          openmontage: adapter,
          mode: "openmontage",
        }),
      ).rejects.toMatchObject({ code: "KILL_SWITCH" });
      expect(calls).toBe(0);

      process.env.TOONFORGE_KILL_SWITCH = "false";
      process.env.TOONFORGE_PER_VIDEO_BUDGET_USD = "1";
      await expect(
        produceCartoon({
          projectId: "p6",
          projectDir: mkdtempSync(join(tmpdir(), "om-budget-")),
          story: story(),
          storyboard: createStoryboard(story()),
          characters: await defaultCharacterRegistry().list(),
          openmontage: adapter,
          mode: "openmontage",
          estimatedCostUsd: 5,
        }),
      ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
      expect(calls).toBe(0);
    } finally {
      if (previousKill == null) delete process.env.TOONFORGE_KILL_SWITCH;
      else process.env.TOONFORGE_KILL_SWITCH = previousKill;
      if (previousBudget == null) delete process.env.TOONFORGE_PER_VIDEO_BUDGET_USD;
      else process.env.TOONFORGE_PER_VIDEO_BUDGET_USD = previousBudget;
    }
  });
});

describe("OpenMontage MCP", () => {
  it("exposes health and backend tools and keeps the offline default", async () => {
    expect(MCP_TOOL_NAMES).toContain("toonforge.openmontage_health");
    expect(MCP_TOOL_NAMES).toContain("toonforge.production_backends");
    const health = await handleTool("toonforge.openmontage_health", {});
    expect(health).toMatchObject({ status: "disabled" });
    const backends = (await handleTool("toonforge.production_backends", {})) as { selected: string };
    expect(backends.selected).toBe("offline_fixture");
  });
});

describe("OpenMontage runner path guard", () => {
  it("rejects a video path outside the workspace before importing OpenMontage", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "om-guard-"));
    const { stdout, code } = await runRunner({
      operation: "render",
      root: join(tmpdir(), "not-a-checkout"),
      workspace,
      video_output_path: "/etc/passwd",
      characters: [{ id: "max", display_name: "Max" }],
      scene_plan: { scenes: [{ id: "s", start_seconds: 0, end_seconds: 1 }] },
    });
    expect(code).not.toBe(0);
    const body = JSON.parse(stdout) as { error_class: string };
    expect(body.error_class).toBe("path_traversal");
  });
});

describe("OpenMontage external smoke", () => {
  it("skips unless OPENMONTAGE_SMOKE=1 and a ready checkout is configured", async (ctx) => {
    if (process.env.OPENMONTAGE_SMOKE !== "1" || !process.env.OPENMONTAGE_ROOT) {
      ctx.skip("OpenMontage checkout is not configured (set OPENMONTAGE_SMOKE=1 and OPENMONTAGE_ROOT)");
    }
  });
});

async function runRunner(payload: unknown): Promise<{ stdout: string; code: number }> {
  // Node 22.14 ignores execFile's `input` option, so stdin must be closed explicitly.
  return new Promise((done) => {
    const child = execFile(
      "python3",
      [resolve("scripts/openmontage_runner.py")],
      { timeout: 15_000 },
      (error, stdout) => {
        const code = typeof error?.code === "number" ? error.code : error ? 1 : 0;
        done({ stdout: String(stdout ?? ""), code });
      },
    );
    child.stdin?.end(JSON.stringify(payload));
  });
}
