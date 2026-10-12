import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rememberChannel } from "../../src/adapters/youtube/account.js";
import { defaultCharacterRegistry } from "../../src/characters/registry.js";
import {
  EXPRESSION_NAMES,
  VIEW_NAMES,
  buildCharacterFrames,
  identityFromCharacter,
  inspectCharacterArtSvg,
  poseForShot,
  poseState,
  renderCastSvg,
  renderMila,
  renderMilo,
} from "../../src/engines/character-art/index.js";
import { resolveProductionAudioConfig } from "../../src/engines/audio/production.js";
import { loadHistoryEpisode, storyFromHistoryEpisode, validateHistoryEpisode } from "../../src/engines/history/episode.js";
import { captionTrack } from "../../src/engines/packaging/index.js";
import { PRODUCTION_DURATION_MAX_SEC, resolveRenderDuration } from "../../src/engines/production/duration.js";
import { publishPreflight } from "../../src/engines/publish/preflight.js";
import { resolvePipelineMode } from "../../src/engines/reference/index.js";
import { runQa } from "../../src/engines/qa/index.js";
import { createStoryboard } from "../../src/engines/storyboard/index.js";
import { loadChannelConfig, loadRuntimeConfig } from "../../src/core/config.js";
import { defaultChannelPath } from "../../src/core/paths.js";
import type { HistoryEpisode } from "../../src/engines/history/episode.js";

const EPISODE = "episodes/alexandria/episode.json";

async function cast() {
  const registry = defaultCharacterRegistry();
  const mila = await registry.get("mila");
  const milo = await registry.get("milo-monkey");
  const fox = await registry.get("milo");
  const bolt = await registry.get("bolt");
  if (!mila || !milo || !fox || !bolt) throw new Error("registry is missing a required character");
  return { mila, milo, fox, bolt };
}

describe("Mila and Milo identities", () => {
  it("locks the written features and leaves Bolt and the fox Milo unfinished", async () => {
    const { mila, milo, fox, bolt } = await cast();
    const milaId = identityFromCharacter(mila);
    const miloId = identityFromCharacter(milo);
    expect(milaId.kind).toBe("mila");
    expect(miloId.kind).toBe("milo-monkey");
    expect(milaId.displayName).toBe("Mila");
    expect(miloId.displayName).toBe("Milo");
    expect(fox.character_id).toBe("milo");
    expect(fox.canonical_description.toLowerCase()).toContain("fox");
    expect(() => identityFromCharacter(fox)).toThrow(/finished art/);
    expect(() => identityFromCharacter(bolt)).toThrow(/finished art/);
    const front = poseState("explain", 0, 12, { view: "front", expression: "confident" });
    const svg = renderCastSvg({
      identities: [milaId, miloId],
      poses: [front, poseState("point", 4, 12, { view: "three-quarter", expression: "curious" })],
      visual: "library shelves and a map",
      onScreenText: "Mouseion",
    });
    expect(inspectCharacterArtSvg(svg, milaId).findings).toEqual([]);
    expect(inspectCharacterArtSvg(svg, miloId).findings).toEqual([]);
    expect(svg).toContain("Mouseion");
    expect(svg).not.toContain("milo-boot");
    for (const view of VIEW_NAMES) {
      const pose = poseState("read", 2, 12, { view, expression: "thoughtful" });
      expect(inspectCharacterArtSvg(renderMila(milaId, pose), milaId).ok).toBe(true);
      expect(inspectCharacterArtSvg(renderMilo(miloId, pose), miloId).ok).toBe(true);
    }
    for (const expression of EXPRESSION_NAMES) {
      const pose = poseState("idle", 1, 12, { expression, view: "front" });
      expect(renderMila(milaId, pose)).toContain(`data-expression="${expression}"`);
    }
  });

  it("uses the shot action for the pose even when the narration mentions another verb", () => {
    expect(poseForShot({ visual: "Mila points at a map while Milo walks up beside her.", narration: "They walk through the stacks and read a scroll.", dialogue: "" }, 0)).toBe("point");
    expect(poseForShot({ visual: "Mila and Milo walk past the shelves and point back at the map.", narration: "The takeaway is careful reading.", dialogue: "" }, 1)).toBe("walk");
    expect(poseForShot({ visual: "Milo examines a scroll while Mila reads beside him.", narration: "A harbor fire is disputed.", dialogue: "" }, 2)).toBe("examine");
  });

  it("maps a short storyboard onto both characters without dropping a shot pose", async () => {
    const { mila, milo } = await cast();
    const episode = loadHistoryEpisode(EPISODE);
    const story = storyFromHistoryEpisode(episode, [mila, milo]);
    const board = createStoryboard(story);
    const shots = board.shots.slice(0, 3).map((shot) => ({ ...shot, duration_seconds: 1 }));
    const frames = buildCharacterFrames({
      characters: [mila, milo],
      storyboard: { ...board, shots },
      durationSec: 3,
      fps: 2,
    });
    expect(frames).toHaveLength(6);
    expect(frames[0]?.pose).toBe("point");
    expect(frames[2]?.pose).toBe("explain");
    expect(frames[4]?.pose).toBe("examine");
    expect(frames[0]?.svg).toContain('data-character-id="mila"');
    expect(frames[0]?.svg).toContain('data-character-id="milo-monkey"');
    expect(frames[0]?.svg).not.toBe(frames[1]?.svg);
  });
});

describe("history research gate", () => {
  it("accepts the Alexandria episode inside 300–600 seconds", () => {
    const episode = loadHistoryEpisode(EPISODE);
    const seconds = episode.scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0);
    expect(seconds).toBeGreaterThanOrEqual(300);
    expect(seconds).toBeLessThanOrEqual(600);
    expect(resolveRenderDuration({ storyboardSec: seconds })).toBe(seconds);
    expect(PRODUCTION_DURATION_MAX_SEC).toBe(600);
    const narration = episode.scenes.map((scene) => scene.narration).join(" ");
    expect(narration).toMatch(/were not/i);
    expect(narration).toMatch(/witness/i);
    expect(episode.sources.every((source) => source.inspected && source.url.startsWith("https://"))).toBe(true);
  });

  it("rejects a missing citation, an uninspected source, and a foreign character", () => {
    const episode = loadHistoryEpisode(EPISODE);
    const uncited: HistoryEpisode = {
      ...episode,
      claims: episode.claims.map((claim) => claim.status === "documented" ? { ...claim, sources: [] } : claim),
    };
    expect(() => validateHistoryEpisode(uncited)).toThrow(/no source/);
    const unread: HistoryEpisode = {
      ...episode,
      sources: episode.sources.map((source, index) => index === 0 ? { ...source, inspected: false } : source),
    };
    expect(() => validateHistoryEpisode(unread)).toThrow(/inspected/);
    const foreign: HistoryEpisode = {
      ...episode,
      scenes: episode.scenes.map((scene, index) => index === 0 ? { ...scene, characters: ["bolt"] } : scene),
    };
    expect(() => validateHistoryEpisode(foreign)).toThrow(/not Mila or Milo/);
    expect(() => resolveRenderDuration({ storyboardSec: 601 })).toThrow(/600/);
  });
});

describe("Mila and Milo channel safeguards", () => {
  it("selects the history channel only from its own file", () => {
    const channel = loadChannelConfig("config/channels/mila-and-milo.yaml");
    expect(channel.youtube_channel_id).toBe("UCFW402c826AbgWKtKs_uAyw");
    expect(channel.schedule.enabled).toBe(false);
    expect(channel.publishing_mode).toBe("private");
    expect(channel.production_backend).toBe("openmontage");
    expect(channel.characters).toEqual(["mila", "milo-monkey"]);
    expect(channel.duration_seconds).toBeGreaterThanOrEqual(300);
    expect(channel.duration_seconds).toBeLessThanOrEqual(600);
    expect(defaultChannelPath()).toMatch(/cartoon-default\.yaml$/);
    expect(loadChannelConfig(defaultChannelPath()).channel_id).toBe("cartoon-default");
    expect(resolvePipelineMode({
      reelmimicEnabled: false,
      openmontageEnabled: false,
      channelBackend: channel.production_backend,
      preferOfflineFixture: true,
    })).toBe("openmontage");
  });

  it("blocks a connected channel that is not Mila and Milo", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tf-mila-channel-"));
    const tokenPath = join(dataDir, "token.json");
    mkdirSync(dataDir, { recursive: true });
    rememberChannel({
      dataDir,
      activeTokenPath: tokenPath,
      channelId: "UC0000000000000000000000",
      title: "Other",
      token: { refresh_token: "refresh-test", access_token: "access-test", scope: "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload" },
      scopes: ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/youtube.upload"],
    });
    const channel = loadChannelConfig("config/channels/mila-and-milo.yaml");
    const config = {
      ...loadRuntimeConfig(),
      dataDir,
      youtube: {
        ...loadRuntimeConfig().youtube,
        clientId: "client",
        clientSecret: "secret",
        tokenPath,
      },
    };
    const preflight = publishPreflight(config, channel);
    expect(preflight.configuredYoutubeChannelId).toBe("UCFW402c826AbgWKtKs_uAyw");
    expect(preflight.blockers).toContain("channel_id_mismatch");
    expect(preflight.blockers).toContain("schedule_disabled");
    expect(preflight.liveAllowed).toBe(false);
  });

  it("rejects missing narration setup and a non-commercial music license", () => {
    expect(() => resolveProductionAudioConfig({})).toThrow(/TOONFORGE_TTS_PROVIDER/);
    expect(() => resolveProductionAudioConfig({
      TOONFORGE_TTS_PROVIDER: "piper",
      TOONFORGE_PIPER_PYTHON: "/tmp/piper-python",
      TOONFORGE_PIPER_MODEL: "/tmp/voice.onnx",
      TOONFORGE_MUSIC_FILE: "/tmp/music.mp3",
      TOONFORGE_TTS_LICENSE: "public-domain",
      TOONFORGE_MUSIC_LICENSE: "cc-by-nc-4.0",
      TOONFORGE_TTS_ATTRIBUTION: "test voice",
      TOONFORGE_MUSIC_TITLE: "Test",
      TOONFORGE_MUSIC_ATTRIBUTION: "test",
      TOONFORGE_TTS_SOURCE_URL: "https://example.com/voice",
      TOONFORGE_MUSIC_SOURCE_URL: "https://example.com/music",
    })).toThrow(/TOONFORGE_MUSIC_LICENSE/);
  });

  it("keeps captions on the spoken timeline and fails QA without them", async () => {
    const episode = loadHistoryEpisode(EPISODE);
    const track = captionTrack(episode.scenes, 318);
    expect(track.vtt.startsWith("WEBVTT")).toBe(true);
    expect(track.vtt).toContain("00:05:18.000");
    expect(track.srt).toContain("00:05:18,000");
    const qa = await runQa({ storyComplete: true, originalContent: true, thirdPartyFootage: false });
    expect(qa.verdict).toBe("FAIL");
    expect(qa.checks.some((check) => check.id === "file.captions" && check.verdict === "FAIL")).toBe(true);
  });
});
