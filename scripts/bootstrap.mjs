#!/usr/bin/env node
/**
 * Local bootstrap. Does not contact GitHub and does not install unpinned packages.
 * From a checkout: node scripts/bootstrap.mjs --check
 * With --install: npm ci && npm run build, then the built CLI setup command.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function nodeOk() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 14);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`toonforge bootstrap

Checks Node.js and, when --install is set, installs this checkout with npm ci.
It does not request a GitHub login or run a downloaded shell script.

  node scripts/bootstrap.mjs --check
  node scripts/bootstrap.mjs --install
`);
  process.exit(0);
}

if (!nodeOk()) {
  console.error(`Node.js >= 22.14 is required. Found ${process.versions.node}.`);
  console.error("Install it from https://nodejs.org/. This bootstrap will not pipe a remote installer.");
  process.exit(2);
}

const cli = resolve(root, "dist/cli/index.js");
if (args.includes("--install")) {
  execFileSync("npm", ["ci"], { cwd: root, stdio: "inherit" });
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
}

if (!existsSync(cli)) {
  console.error("The ToonForge CLI is not built. From this checkout run: node scripts/bootstrap.mjs --install");
  console.error("A public npm package is not published. Do not use an unpinned npx package name.");
  process.exit(existsSync(resolve(root, "package.json")) ? 2 : 3);
}

const forwarded = args.filter((arg) => arg !== "--install");
const setupArgs = forwarded.length ? forwarded : ["setup", "--check"];
const child = spawnSync(process.execPath, [cli, ...setupArgs], { cwd: root, stdio: "inherit" });
process.exit(child.status ?? 1);
