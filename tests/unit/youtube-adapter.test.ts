import { describe, expect, it } from "vitest";
import { createYoutubeAdapter } from "../../src/adapters/youtube/index.js";

describe("youtube adapter foundation", () => {
  it("validates metadata and stubs upload", async () => {
    const yt = createYoutubeAdapter({
      redirectUri: "http://127.0.0.1",
      tokenPath: "./data/youtube-token.json",
      defaultPrivacy: "private",
    });
    const bad = await yt.validate_metadata({
      title: "",
      description: "",
      privacyStatus: "private",
    });
    expect(bad.ok).toBe(false);

    const result = await yt.upload({
      idempotencyKey: "pub:p:v",
      videoPath: "/tmp/missing.mp4",
      metadata: {
        title: "Test",
        description: "Desc",
        privacyStatus: "private",
      },
    });
    expect(result.status).toBe("stub");
  });
});
