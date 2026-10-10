# Installer

ToonForge is not on the npm registry. Do not `curl` a shell script and do not `npx` an unpinned package name.

## Checkout bootstrap

`scripts/bootstrap.mjs` is the one-command entry for a local checkout:

```bash
node scripts/bootstrap.mjs --check
node scripts/bootstrap.mjs --install
```

`--check` requires Node.js >= 22.14 and a built `dist/cli/index.js`. If the CLI is missing it exits 2 and tells you to pass `--install`.

`--install` runs `npm ci` and `npm run build` with `execFile` (no shell), then `setup --check`. It does not contact GitHub, request a token, or install FFmpeg for you.

`scripts/install.sh` remains a thin development helper that also runs npm ci, build, and doctor inside the checkout. Prefer `bootstrap.mjs`.

## Packed tarball

```bash
npm run build
npm pack --dry-run
npm pack
npm install --prefix /tmp/tf-install ./toonforge-0.1.0.tgz
node /tmp/tf-install/node_modules/toonforge/dist/cli/index.js --help
```

The published file list is `dist`, `characters`, `config`, `scripts/openmontage_runner.py`, `scripts/bootstrap.mjs`, README, LICENSE, notices, and `docs`. It excludes `.env`, `data/`, tokens, tests, and generated video.

## setup

```bash
toonforge setup --check --non-interactive
toonforge setup --client cursor|gemini|claude|chatgpt
toonforge setup --client cursor --apply --non-interactive
toonforge doctor
```

Exit code 2 means a required dependency failed detection. Exit code 0 means required commands were found. Optional misses are warnings.

The command creates the data directory and copies `.env.example` to `config.env` only when `config.env` is absent. Re-running does not replace that file or tokens.

`--apply` is the confirmation step for client files. Without it, setup prints the JSON and writes nothing to the client path.

## Platforms

Detection and install hints exist for macOS (`darwin`), Linux, and Windows (`win32`) in `config/dependencies.json`. Automated tests mock the command runner; they do not change the host package manager. CI runs the pack smoke on Ubuntu.

FFmpeg on Linux may require `sudo` for `apt`. ToonForge will not run that sudo for you. The doctor output includes the install hint.

## Uninstall and repair

- Repair: `toonforge doctor` and `toonforge setup --check`.
- Remove a global tarball install: `npm uninstall -g toonforge`.
- Remove user data yourself: `~/.toonforge` and `TOONFORGE_DATA_DIR`.
- `toonforge update` exits 3 and does not download anything.

## Not installed automatically

ReelMimic, OpenMontage, OmniChar, GPU drivers, and paid model accounts. See [dependency-matrix.md](../integrations/dependency-matrix.md).
