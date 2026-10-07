# GitHub Development Workflow

## Branching

- Default branch: `main` (protected when possible)
- Feature branches: `cursor/<descriptive-name>-55f7` or `feat/<name>`, `fix/<name>`
- Never push feature work directly to `main`

## PR flow

1. Create feature branch from up-to-date `main`
2. Make focused changes
3. Run `npm run typecheck` and `npm test`
4. Update docs when behavior/contracts change
5. Commit with a clear message (`feat:`, `docs:`, `test:`, `chore:`)
6. Push branch: `git push -u origin <branch>`
7. Open PR with purpose, audit notes, test plan
8. Wait for CI
9. Review diff
10. Merge only when required checks pass

## Required status checks (recommended)

- `ci / test` — install, typecheck, unit tests

## Branch protection (recommended)

- Require PR before merge
- Require status checks
- Disallow force-push to `main`
- Optionally require linear history / squash merge

## Tokens

Use least privilege:

- Contents: read/write (for PR branches)
- Pull requests: write
- Workflows: write only if updating Actions
- Never commit PATs into the repo

Note: Cursor’s GitHub MCP token may be read-only even when `gh` CLI write works. Prefer `gh`/`git` for ToonForge automation until MCP write scopes are fixed.

## Auto-merge

Allowed only when:

- CI green
- Required reviews/status checks satisfied
- No unresolved blocking policy/QA issues in the change itself

Do **not** build a bot that blindly approves arbitrary PRs.

## CI failure recovery

1. Read Actions logs
2. Reproduce locally (`npm ci && npm test`)
3. Fix on the same feature branch
4. Push; do not bypass failing checks
