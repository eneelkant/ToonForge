#!/usr/bin/env node
import { loadChannelConfig, loadRuntimeConfig } from "../core/config.js";
import { defaultCharacterRegistry } from "../characters/registry.js";
import { getSystemStatus } from "../mcp/tools/system.js";
import { createOrchestrator } from "../adapters/ruflo/index.js";
import { runDoctor } from "./doctor.js";

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
    const dryRun = !rest.includes("--publish");
    console.log(JSON.stringify(await runDailyWorkflow({ dryRun }), null, 2));
    return;
  }

  if (cmd === "mcp") {
    const { startMcpStdio } = await import("../mcp/server.js");
    await startMcpStdio();
    return;
  }

  if (cmd === "config" && sub === "channel") {
    const path = rest[0] || "config/channels/cartoon-default.yaml";
    console.log(JSON.stringify(loadChannelConfig(path), null, 2));
    return;
  }

  if (cmd === "pause" || cmd === "resume") {
    console.log(
      JSON.stringify({
        ok: true,
        note: `${cmd} is foundation-level; set TOONFORGE_KILL_SWITCH=true/false for hard stop`,
        killSwitch: config.killSwitch,
      }),
    );
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
  system status
  config channel [path]
  workflow start [name]
  workflow run daily [--publish]
  workflow status <id>
  mcp
  pause
  resume
  help
`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
