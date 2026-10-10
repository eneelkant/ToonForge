#!/usr/bin/env node
import { loadChannelConfig, loadRuntimeConfig } from "../core/config.js";
import { defaultCharacterRegistry } from "../characters/registry.js";
import { getSystemStatus } from "../mcp/tools/system.js";
import { createOrchestrator } from "../adapters/ruflo/index.js";
import { runDoctor } from "./doctor.js";
import { dispatchExtended, extendedHelp } from "./extended.js";
import { resolvePublishMode } from "../core/publish-mode.js";

async function main(): Promise<void> {
  const [cmd, sub, ...rest] = process.argv.slice(2);
  const config = loadRuntimeConfig();

  if (!cmd || cmd === "help" || cmd === "--help") {
    printHelp();
    return;
  }

  if (cmd === "doctor") {
    await runDoctor();
    return;
  }

  if (cmd === "characters" && sub === "list") {
    const chars = await defaultCharacterRegistry().list();
    console.log(JSON.stringify(chars.map((c) => ({ id: c.character_id, name: c.display_name })), null, 2));
    return;
  }

  if (cmd === "omnichar" && sub === "health") {
    const { createOmniCharAdapter } = await import("../adapters/omnichar/index.js");
    const adapter = createOmniCharAdapter(config.omnichar);
    console.log(JSON.stringify(await adapter.health(), null, 2));
    return;
  }

  if (cmd === "omnichar" && sub === "list") {
    const { createOmniCharAdapter } = await import("../adapters/omnichar/index.js");
    const adapter = createOmniCharAdapter(config.omnichar);
    console.log(JSON.stringify(await adapter.listCharacters(), null, 2));
    return;
  }

  if (cmd === "openmontage" && sub === "health") {
    const { createOpenMontageAdapter } = await import("../adapters/openmontage/index.js");
    const adapter = createOpenMontageAdapter(config.openmontage);
    console.log(JSON.stringify(await adapter.health(), null, 2));
    return;
  }

  if (cmd === "reelmimic" && sub === "health") {
    const { createReelMimicAdapter } = await import("../adapters/reelmimic/index.js");
    const adapter = createReelMimicAdapter(config.reelmimic);
    console.log(JSON.stringify(await adapter.health(), null, 2));
    return;
  }

  if (cmd === "system" && sub === "status") {
    console.log(JSON.stringify(await getSystemStatus(config), null, 2));
    return;
  }

  if (cmd === "workflow" && sub === "status") {
    const id = rest[0];
    if (!id) {
      console.error("usage: toonforge workflow status <id>");
      process.exitCode = 1;
      return;
    }
    const orch = createOrchestrator(config.ruflo);
    console.log(JSON.stringify(await orch.workflow.status(id), null, 2));
    return;
  }

  if (cmd === "workflow" && sub === "start") {
    const name = rest[0] || "daily";
    const orch = createOrchestrator(config.ruflo);
    console.log(JSON.stringify(await orch.workflow.start(name), null, 2));
    return;
  }

  if (cmd === "workflow" && sub === "run" && rest[0] === "daily") {
    const { runDailyWorkflow } = await import("../engines/workflow/daily.js");
    const publishFlag = rest.includes("--publish");
    const mode = resolvePublishMode({ config, requestedLive: publishFlag });
    if (publishFlag && mode.dryRun) {
      console.error(`NOTE: ${mode.reason}`);
    }
    console.log(JSON.stringify(await runDailyWorkflow({ dryRun: mode.dryRun, publish: publishFlag }), null, 2));
    return;
  }

  if (cmd === "mcp") {
    if (sub === "--http" || rest.includes("--http")) {
      const { startMcpHttp } = await import("../mcp/http.js");
      const portFlag = rest[rest.indexOf("--port") + 1];
      await startMcpHttp({
        port: rest.includes("--port") ? Number(portFlag) : undefined,
      });
      return;
    }
    const { startMcpStdio } = await import("../mcp/server.js");
    await startMcpStdio();
    return;
  }

  if (cmd === "config" && sub === "channel") {
    const path = rest[0] || "config/channels/cartoon-default.yaml";
    console.log(JSON.stringify(loadChannelConfig(path), null, 2));
    return;
  }

  if (await dispatchExtended(cmd, sub, rest, config)) return;

  if (cmd === "pause" || cmd === "resume") {
    const { pauseGlobal, resumeGlobal } = await import("../scheduler/index.js");
    if (cmd === "pause") pauseGlobal(config.dataDir);
    else resumeGlobal(config.dataDir);
    console.log(JSON.stringify({
      ok: true,
      paused: cmd === "pause",
      killSwitch: config.killSwitch,
      note: "Scheduler pause is persistent. TOONFORGE_KILL_SWITCH remains the hard stop.",
    }));
    return;
  }

  console.error(`Unknown command: ${cmd} ${sub ?? ""}`.trim());
  printHelp();
  process.exitCode = 1;
}

function printHelp(): void {
  console.log(`toonforge <command>

Commands:
  doctor
  characters list
  omnichar health
  omnichar list
  reelmimic health
  openmontage health
  system status
  config channel [path]
  workflow start [name]
  workflow run daily [--publish]
  workflow status <id>
  mcp
  mcp --http
  pause
  resume
${extendedHelp()}  help
`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
