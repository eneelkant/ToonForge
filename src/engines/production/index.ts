import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Storyboard } from "../storyboard/index.js";
import type { OriginalStory } from "../story/index.js";
import { ToonForgeError } from "../../core/errors.js";

export interface ProductionResult {
  projectId: string;
  videoPath: string;
  stub: boolean;
  detail: string;
}

/** Local mock/renderer: writes a deterministic placeholder MP4-like artifact for offline pipelines. */
export function produceLocalCartoon(input: {
  projectId: string;
  projectDir: string;
  story: OriginalStory;
  storyboard: Storyboard;
  reelmimicProjectId?: string;
}): ProductionResult {
  const outDir = join(input.projectDir, "out");
  mkdirSync(outDir, { recursive: true });
  const videoPath = join(outDir, "video.mp4");
  // Placeholder bytes — not a real MP4 container; QA will flag unless mock mode accepts it.
  const payload = Buffer.from(
    `TOONFORGE_LOCAL_RENDER\nproject=${input.projectId}\nstory=${input.story.story_id}\nshots=${input.storyboard.shots.length}\n`,
    "utf8",
  );
  writeFileSync(videoPath, payload);
  writeFileSync(
    join(outDir, "production.json"),
    JSON.stringify(
      {
        projectId: input.projectId,
        storyId: input.story.story_id,
        storyboardId: input.storyboard.storyboard_id,
        reelmimicProjectId: input.reelmimicProjectId ?? null,
        stub: true,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  if (!existsSync(videoPath)) {
    throw new ToonForgeError({
      code: "UPSTREAM_ERROR",
      message: "Production failed to write video artifact",
      component: "engines.production",
    });
  }
  return {
    projectId: input.projectId,
    videoPath,
    stub: true,
    detail: "Local stub render written; wire ReelMimic for real animation",
  };
}
