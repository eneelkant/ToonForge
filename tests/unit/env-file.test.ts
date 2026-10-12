import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOAuth2Client } from "../../src/adapters/youtube/oauth.js";
import { CANONICAL_YOUTUBE_REDIRECT_URI, assertLoopbackRedirect } from "../../src/adapters/youtube/connect.js";
import { dispatchExtended } from "../../src/cli/extended.js";
import { loadRuntimeConfig } from "../../src/core/config.js";
import {
  applyEnvText,
  loadProjectEnv,
  missingYoutubeOAuthVars,
  youtubeOAuthMissingMessage,
} from "../../src/core/env.js";
import { rootLogger } from "../../src/core/logging.js";

const TARGET = "UCFW402c826AbgWKtKs_uAyw";
const OTHER = "UCotherchannelid00000000";
const SECRET = "fixture-secret-value";

vi.mock("googleapis", () => ({
  google: {
    youtube() {
      const bucket = (globalThis as GoogleProbe).__toonforgeGoogle;
      if (bucket) bucket.youtube += 1;
      throw new Error("Google API request attempted");
    },
    auth: {
      OAuth2: class {
        constructor() {
          const bucket = (globalThis as GoogleProbe).__toonforgeGoogle;
          if (bucket) bucket.oauth += 1;
        }
        setCredentials(): void {}
        on(): void {}
        generateAuthUrl(): string {
          return "https://accounts.google.com/o/oauth2/v2/auth";
        }
        getToken(): Promise<never> {
          throw new Error("Google API request attempted");
        }
      },
    },
  },
}));

interface GoogleProbe {
  __toonforgeGoogle?: { oauth: number; youtube: number };
}

function googleProbe(): { oauth: number; youtube: number } {
  const bucket = (globalThis as GoogleProbe).__toonforgeGoogle ?? { oauth: 0, youtube: 0 };
  (globalThis as GoogleProbe).__toonforgeGoogle = bucket;
  return bucket;
}

beforeEach(() => {
  (globalThis as GoogleProbe).__toonforgeGoogle = { oauth: 0, youtube: 0 };
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
});

function writeEnv(dir: string, body: string): string {
  const path = join(dir, ".env");
  writeFileSync(path, body);
  return path;
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

function childEnv(file: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, TOONFORGE_ENV_FILE: file, ...extra };
  for (const key of ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REDIRECT_URI", "YOUTUBE_CHANNEL_ID"]) {
    if (!(key in extra)) delete env[key];
  }
  return env;
}

describe("project env file", () => {
  it("loads a valid env file into unset keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-env-"));
    const file = writeEnv(dir, [
      "# comment",
      "export YOUTUBE_CLIENT_ID=fixture-client-id",
      `YOUTUBE_CLIENT_SECRET=${SECRET}`,
      "YOUTUBE_REDIRECT_URI=http://127.0.0.1:53682/",
      `YOUTUBE_CHANNEL_ID=${TARGET}`,
      "",
    ].join("\n"));
    const env: NodeJS.ProcessEnv = { VITEST: "true", TOONFORGE_ENV_FILE: file };
    const loaded = loadProjectEnv(env);
    expect(loaded.loaded).toBe(true);
    expect(env.YOUTUBE_CLIENT_ID).toBe("fixture-client-id");
    expect(env.YOUTUBE_CLIENT_SECRET).toBe(SECRET);
    expect(env.YOUTUBE_REDIRECT_URI).toBe(CANONICAL_YOUTUBE_REDIRECT_URI);
    expect(env.YOUTUBE_CHANNEL_ID).toBe(TARGET);
  });

  it("keeps externally supplied variables when the env file is missing", () => {
    const env: NodeJS.ProcessEnv = {
      VITEST: "true",
      TOONFORGE_ENV_FILE: join(tmpdir(), "tf-env-missing", "nope.env"),
      YOUTUBE_CLIENT_ID: "from-shell",
    };
    const loaded = loadProjectEnv(env);
    expect(loaded.loaded).toBe(false);
    expect(env.YOUTUBE_CLIENT_ID).toBe("from-shell");
    expect(env.YOUTUBE_CLIENT_SECRET).toBeUndefined();
  });

  it("lets an existing shell variable win over the env file", () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-env-"));
    const file = writeEnv(dir, `YOUTUBE_CHANNEL_ID=${OTHER}\nYOUTUBE_CLIENT_ID=from-file\n`);
    const env: NodeJS.ProcessEnv = {
      VITEST: "true",
      TOONFORGE_ENV_FILE: file,
      YOUTUBE_CHANNEL_ID: TARGET,
    };
    loadProjectEnv(env);
    expect(env.YOUTUBE_CHANNEL_ID).toBe(TARGET);
    expect(env.YOUTUBE_CLIENT_ID).toBe("from-file");
    expect(applyEnvText(`YOUTUBE_CHANNEL_ID=${OTHER}\n`, { YOUTUBE_CHANNEL_ID: TARGET })).toEqual([]);
  });

  it("does not read the developer env file during tests unless a path is explicit", () => {
    const env: NodeJS.ProcessEnv = { VITEST: "true" };
    const loaded = loadProjectEnv(env);
    expect(loaded.path).toBeNull();
    expect(loaded.loaded).toBe(false);
    expect(env.YOUTUBE_CLIENT_SECRET).toBeUndefined();
  });
});

describe("oauth configuration diagnostics", () => {
  it("names the missing variables and omits secret values from errors and logs", async () => {
    const message = youtubeOAuthMissingMessage(missingYoutubeOAuthVars({
      YOUTUBE_CLIENT_SECRET: SECRET,
    }));
    expect(message).toBe(
      "YouTube OAuth configuration is incomplete. Missing: YOUTUBE_CLIENT_ID. Configure these in the local environment or ignored .env file.",
    );
    expect(message).not.toContain(SECRET);

    const lines: string[] = [];
    const original = console.error;
    console.error = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      rootLogger.error("oauth.diagnostics", { clientSecret: SECRET, note: message });
      const config = loadRuntimeConfig({ TOONFORGE_DATA_DIR: mkdtempSync(join(tmpdir(), "tf-env-")) });
      const handled = await dispatchExtended("youtube", "connect", ["--channel", TARGET], config);
      expect(handled).toBe(true);
    } finally {
      console.error = original;
    }
    const output = lines.join("\n");
    expect(output).toContain("Missing: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET");
    expect(output).not.toContain(SECRET);
    expect(output).toContain("[REDACTED]");
    expect(process.exitCode).toBe(2);
    expect(googleProbe()).toEqual({ oauth: 0, youtube: 0 });

    expect(() => createOAuth2Client({
      clientId: "fixture-client-id",
      redirectUri: CANONICAL_YOUTUBE_REDIRECT_URI,
      tokenPath: "./data/youtube-token.json",
      defaultPrivacy: "private",
      dryRunDefault: true,
    })).toThrow(/Missing: YOUTUBE_CLIENT_SECRET/);
    expect(googleProbe().oauth).toBe(0);
  });

  it("uses the canonical redirect and rejects a privileged loopback URI before any Google client exists", async () => {
    expect(loadRuntimeConfig({}).youtube.redirectUri).toBe("http://127.0.0.1:53682/");
    expect(assertLoopbackRedirect(CANONICAL_YOUTUBE_REDIRECT_URI).href).toBe("http://127.0.0.1:53682/");
    expect(() => assertLoopbackRedirect("http://127.0.0.1/")).toThrow(/non-privileged/);

    const lines: string[] = [];
    const original = console.error;
    console.error = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      const config = loadRuntimeConfig({
        YOUTUBE_CLIENT_ID: "fixture-client-id",
        YOUTUBE_CLIENT_SECRET: SECRET,
        YOUTUBE_REDIRECT_URI: "http://127.0.0.1/",
      });
      await dispatchExtended("youtube", "connect", ["--channel", TARGET], config);
    } finally {
      console.error = original;
    }
    const output = lines.join("\n");
    expect(output).toMatch(/non-privileged/);
    expect(output).not.toContain(SECRET);
    expect(process.exitCode).toBe(2);
    expect(googleProbe()).toEqual({ oauth: 0, youtube: 0 });
  });

  it("loads the env file for the CLI and keeps shell values ahead of it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tf-env-cli-"));
    const file = writeEnv(dir, [
      "YOUTUBE_CLIENT_ID=fixture-client-id",
      `YOUTUBE_CLIENT_SECRET=${SECRET}`,
      "YOUTUBE_REDIRECT_URI=http://127.0.0.1:53682/",
      "YOUTUBE_CHANNEL_ID=not-a-channel",
      "",
    ].join("\n"));
    const status = await runCli(["youtube", "status"], childEnv(file, { YOUTUBE_CHANNEL_ID: TARGET }));
    const parsed = JSON.parse(status.stdout) as { clientConfigured: boolean; tokenPresent: boolean; livePublishingEnabled: boolean };
    expect(status.code).toBe(0);
    expect(parsed.clientConfigured).toBe(true);
    expect(parsed.tokenPresent).toBe(false);
    expect(parsed.livePublishingEnabled).toBe(false);
    expect(status.stdout + status.stderr).not.toContain(SECRET);

    const preflight = await runCli(["publish", "preflight"], childEnv(file, {
      YOUTUBE_CHANNEL_ID: TARGET,
      TOONFORGE_DATA_DIR: dir,
    }));
    const report = JSON.parse(preflight.stdout.slice(preflight.stdout.indexOf("{"))) as { channelBinding: string };
    expect(report.channelBinding).toBe("authenticated_channel_missing");
    expect(preflight.stdout + preflight.stderr).not.toContain(SECRET);

    const missingFile = join(dir, "absent.env");
    const external = await runCli(["youtube", "status"], childEnv(missingFile, {
      YOUTUBE_CLIENT_ID: "from-shell",
      YOUTUBE_CLIENT_SECRET: SECRET,
    }));
    const externalJson = JSON.parse(external.stdout) as { clientConfigured: boolean };
    expect(external.code).toBe(0);
    expect(externalJson.clientConfigured).toBe(true);
    expect(external.stdout + external.stderr).not.toContain(SECRET);

    const incomplete = writeEnv(dir, `UNRELATED=ok\nYOUTUBE_CLIENT_SECRET=${SECRET}\n`);
    const connect = await runCli(["youtube", "connect", "--channel", TARGET], childEnv(incomplete));
    expect(connect.code).toBe(2);
    expect(connect.stderr).toContain("Missing: YOUTUBE_CLIENT_ID");
    expect(connect.stderr).not.toContain(SECRET);
    expect(connect.stdout + connect.stderr).not.toMatch(/accounts\.google\.com|googleapis/);
  }, 30_000);

  it("wires the CLI, doctor, and MCP server through the same loader", () => {
    for (const path of ["src/cli/index.ts", "src/cli/doctor.ts", "src/mcp/server.ts"]) {
      expect(readFileSync(path, "utf8")).toContain("loadProjectEnv()");
    }
  });
});
