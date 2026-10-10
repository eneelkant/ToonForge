import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { ToonForgeError } from "../../core/errors.js";
import type { TokenJson } from "./oauth.js";

export function newOAuthState(): string {
  return randomBytes(24).toString("hex");
}

export function assertLoopbackRedirect(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToonForgeError({
      code: "CONFIG_INVALID",
      message: "YOUTUBE_REDIRECT_URI is not a URL",
      component: "adapters.youtube.connect",
    });
  }
  if (url.protocol !== "http:") {
    throw new ToonForgeError({
      code: "CONFIG_INVALID",
      message: "The local OAuth redirect must be http on a loopback host",
      component: "adapters.youtube.connect",
    });
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new ToonForgeError({
      code: "POLICY_VIOLATION",
      message: "OAuth redirect host must be 127.0.0.1 or localhost",
      component: "adapters.youtube.connect",
    });
  }
  if (!url.port || url.port === "80") {
    throw new ToonForgeError({
      code: "CONFIG_INVALID",
      message: "Set YOUTUBE_REDIRECT_URI to a loopback URL with a non-privileged port, for example http://127.0.0.1:53682/",
      component: "adapters.youtube.connect",
    });
  }
  return url;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function waitForLoopbackCode(input: {
  hostname: string;
  port: number;
  expectedState: string;
  timeoutMs: number;
  path?: string;
  onListening?: (port: number) => void;
}): Promise<{ code: string; port: number }> {
  const expectedPath = input.path ?? "/";
  return new Promise((resolve, reject) => {
    let boundPort = input.port;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== expectedPath) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      const oauthError = url.searchParams.get("error");
      if (oauthError) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("Authorization was declined. You can close this window.");
        server.close();
        reject(new ToonForgeError({
          code: "POLICY_VIOLATION",
          message: `Google OAuth returned ${oauthError}`,
          component: "adapters.youtube.connect",
        }));
        return;
      }
      if (!safeEqual(state, input.expectedState) || !code) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("Authorization state did not match. You can close this window.");
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ToonForge received the authorization code. You can close this window.");
      server.close();
      resolve({ code, port: boundPort });
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new ToonForgeError({
        code: "UPSTREAM_ERROR",
        message: "Timed out waiting for the YouTube OAuth redirect",
        component: "adapters.youtube.connect",
        retryable: true,
      }));
    }, input.timeoutMs);
    server.on("close", () => clearTimeout(timer));
    server.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.listen(input.port, input.hostname, () => {
      const address = server.address();
      if (address && typeof address === "object") boundPort = address.port;
      input.onListening?.(boundPort);
    });
  });
}

export function browserCommand(platform: NodeJS.Platform, url: string): { command: string; args: string[] } | null {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "accounts.google.com") return null;
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

export function openSystemBrowser(url: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  const spec = browserCommand(platform, url);
  if (!spec) {
    return Promise.reject(new ToonForgeError({
      code: "POLICY_VIOLATION",
      message: "Refusing to open a non-Google authorization URL",
      component: "adapters.youtube.connect",
    }));
  }
  return new Promise((resolve, reject) => {
    execFile(spec.command, spec.args, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export interface ChannelIdentity {
  channelId: string;
  title: string;
}

export async function connectYoutube(input: {
  redirectUri: string;
  timeoutMs?: number;
  authorizationUrl: (state: string) => string;
  exchangeCode: (code: string) => Promise<TokenJson>;
  listChannels: (token: TokenJson) => Promise<ChannelIdentity[]>;
  openBrowser?: (url: string) => Promise<void>;
  selectChannelId?: string;
}): Promise<{ token: TokenJson; channel: ChannelIdentity; scopes: string[] }> {
  const redirect = assertLoopbackRedirect(input.redirectUri);
  const state = newOAuthState();
  const authUrl = input.authorizationUrl(state);
  const pending = waitForLoopbackCode({
    hostname: redirect.hostname,
    port: Number(redirect.port),
    expectedState: state,
    timeoutMs: input.timeoutMs ?? 180_000,
    path: redirect.pathname || "/",
  });
  if (input.openBrowser) await input.openBrowser(authUrl);
  const { code } = await pending;
  const token = await input.exchangeCode(code);
  const channels = await input.listChannels(token);
  if (channels.length === 0) {
    throw new ToonForgeError({
      code: "ADAPTER_UNAVAILABLE",
      message: "The authorized account has no YouTube channel",
      component: "adapters.youtube.connect",
    });
  }
  const channel = input.selectChannelId
    ? channels.find((item) => item.channelId === input.selectChannelId)
    : channels[0];
  if (!channel) {
    throw new ToonForgeError({
      code: "VALIDATION_FAILED",
      message: "The requested channel id is not available to this Google account",
      component: "adapters.youtube.connect",
      context: { available: channels.map((item) => item.channelId) },
    });
  }
  return {
    token,
    channel,
    scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [],
  };
}
