# ToonForge Architecture

**Status:** Node.js CLI, MCP server, dry-run workflow, optional ReelMimic and OpenMontage adapters, YouTube OAuth adapter, and a file-backed scheduler.  
**Repo license:** Apache-2.0  
**Primary language:** TypeScript (Node.js ≥ 22.14)  
**Capability detail:** [capabilities.md](capabilities.md)

The sections below include the original 2026-10-07 upstream audit. Where they say a stage was not built yet, prefer `src/` and [capabilities.md](capabilities.md).

---

## 1. Historical starting point

Before the foundation work, ToonForge contained only:

| Path | Notes |
|------|--------|
| `README.md` | One-line product tagline |
| `LICENSE` | Apache License 2.0 |

There was no application code, package manifest, tests, CI, adapters, or config. The repository is effectively a greenfield product shell under Apache-2.0.

---

## 2. Intended architecture

ToonForge is the **product**. Upstream projects are **engines** reached only through **adapters**.

```
ToonForge
├── MCP Server          — business-level tools for agents/clients
├── Agent Runtime       — specialized agents + Supervisor
├── Workflow Engine     — state machine + local/Ruflo orchestration
├── Trend Engine        — discovery / score / select
├── Story Engine        — original story from trend opportunity
├── Character Engine    — CharacterRegistry + OmniChar adapter
├── Production Engine   — ReelMimic, optional OpenMontage, or explicit offline fixture
├── Audio Engine        — voice / dialogue / music / mix (provider interfaces)
├── Thumbnail Engine    — candidates + scoring
├── QA Engine           — PASS / WARN / BLOCK gates
├── YouTube Engine      — upload / schedule / analytics (adapter)
├── Analytics Engine    — ingest / score / recommend (controlled)
├── Memory / State      — durable workflow + learning store
├── Scheduler           — cron, timezone, kill switch, budgets
├── Configuration       — channels, thresholds, schedules
├── Observability       — structured JSON logs + run metadata
└── CLI                 — doctor, trends, story, video, qa, youtube, workflow
```

### Adapter boundary rule

Application code depends on **ToonForge interfaces** in `src/adapters/*/types.ts` (and engine facades).  
It must not import OmniChar, ReelMimic, OpenMontage, Ruflo, or AgentTube internals directly.

---

## 3. Dependency map (audited)

| Role | Upstream | Resolved URL | Language | License (inspected) | Integration mode |
|------|----------|--------------|----------|---------------------|------------------|
| Character consistency / `.char` | OmniChar | https://github.com/omnichar/OmniChar | Python + TS UI | **GPL-3.0-or-later** | Process/HTTP only |
| Cartoon production / reference analysis | ReelMimic | https://github.com/edenfunf/reelmimic | TypeScript + Python | **MIT** (+ bundled Apache/MIT third-party skills) | Local HTTP + file contract |
| Optional character animation / composition | OpenMontage | https://github.com/calesthio/OpenMontage | Python + Node (Remotion) | **AGPL-3.0** | Separate checkout + stdin JSON runner. No vendored source. |
| Agent planning guidance | andrej-karpathy-skills | https://github.com/multica-ai/andrej-karpathy-skills | Markdown policies | README claims **MIT**; **no LICENSE file**; GitHub `license: null` | Concept translation into ToonForge policies (no vendored copy until clarified) |
| YouTube publish / schedule / analytics | youtube-automation-agent (AgentTube / Lumen) | https://github.com/darkzOGx/youtube-automation-agent | Node.js | **MIT** | Adapter over googleapis patterns + optional subprocess later |
| Orchestration / memory | Ruflo (`ruflo` / `claude-flow` npm) | https://github.com/ruvnet/ruflo | TypeScript | **MIT** | Optional MCP/CLI; local fallback required |

### YouTube repository resolution

The prompt URL `darkzOGx/youtube-automation-agent-` (trailing dash) **does not exist**.

Resolved canonical repository:

- https://github.com/darkzOGx/youtube-automation-agent

Also observed: a third-party mirror `Fork-Auto-SocialBots/youtube-automation-agent` claiming to mirror the same project. ToonForge will target the **canonical** `darkzOGx` repo.

---

## 4. Integration boundaries

### OmniChar (characters) — GPL isolation

**Verified capabilities (from upstream):**

- Portable `.char` zip container (`magic: INLINECHAR`, `format_version: 1`)
- Headless HTTP API: `GET /v1/health`, `GET /v1/models`, `POST /v1/runs`, `GET /v1/runs/{id}`, websocket events, `POST /v1/assets`, takes endpoints
- Entry: `core/webui.sh` / `python main.py` (default port **8848**)
- Package: `omnichar-core` (PyPI name), import `inline_core`

**ToonForge rule:** call OmniChar only as an **external process or HTTP service**. Do **not** copy GPL sources into ToonForge or statically link them into the Apache-2.0 distribution. Distributing a combined product that includes OmniChar may impose GPL copyleft on the combined work — document and keep optional.

### ReelMimic (production)

**Verified capabilities:**

- Local server via `./start.sh` → http://localhost:**4318**
- Reference analysis: `analyze.py <file-or-url> --out <project>/analysis` → `report.json`
- HTTP: create project, approve plan, resume/retry/cancel, SSE events, file serving
- Workflow stages: analyzing → styling → planning → plan_review → producing → critiquing → done
- Requires Node ≥ 22.18, Python ≥ 3.10, FFmpeg, Chrome, Claude Code **or** Codex CLI

**ToonForge rule:** adapter discovers server health and maps ToonForge `ProductionEngine` operations onto the real REST/file contract. Do not invent CLI flags that are not documented.

### OpenMontage (optional production)

Inspected commit `9327439db69021ab4b0e2776729bf3b58fdb5a87`. License file is GNU AGPL-3.0. Python requires 3.10+. There is no production REST API. The agent drives `pipeline_defs/` and calls `BaseTool.execute()`.

The ToonForge adapter calls only the local character-animation tools (`character_spec_generator`, `svg_rig_builder`, `pose_library_builder`, `action_timeline_compiler`, `character_rig_renderer`) through `scripts/openmontage_runner.py`. It does not download reference footage and does not fall back to another backend when that render fails.

`pipeline_defs/character-animation.yaml` still requires human approval on several agent stages. ToonForge does not run that agent workflow and does not write fake approvals. See `docs/integrations/openmontage.md`.

### Ruflo (orchestration)

**Verified capabilities:**

- npm: `ruflo` / `claude-flow` v3.54.0 (MIT)
- MCP: `npx -y ruflo@latest mcp start`
- Agent/swarm CLIs (`agent spawn`, `hive-mind`, etc.)

**ToonForge rule:** expose ToonForge orchestration APIs (`workflow.*`, `agent.*`). Use Ruflo when enabled; otherwise **LocalWorkflowRunner**.

### YouTube (publishing)

**Verified capabilities (AgentTube):**

- Node ≥ 18, `googleapis` YouTube Data API v3
- OAuth desktop client, schedule queue, idempotent schedule reuse, upload reconciliation when outcome unknown
- Analytics agents, fail-closed narration/QA gates
- Scripts: `npm start`, `npm run scheduler`, per-agent scripts

**ToonForge rule:** implement `YoutubeAdapter` interface first. Prefer calling YouTube Data API through ToonForge’s own adapter (credentials via env). Optionally wrap AgentTube later; never merge the whole app into ToonForge.

### Karpathy skills (guidance)

**Verified:** four principles in `CLAUDE.md` / `CURSOR.md` — Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution.

**ToonForge rule:** encode equivalent policies under `src/core/policies/`. Do not claim license certainty beyond “README states MIT; LICENSE file missing.”

---

## 5. Process model

| Process | Purpose | Default port |
|---------|---------|--------------|
| `toonforge` CLI / Node runtime | Product orchestration, MCP, scheduler | n/a (stdio / local) |
| OmniChar Core (optional) | Character encode/score/generate | 8848 |
| ReelMimic server (optional) | Reference analysis + production | 4318 |
| OpenMontage checkout (optional) | Character animation tools via local Python | n/a (subprocess) |
| Ruflo MCP (optional) | Swarm/memory orchestration | stdio or HTTP |
| FFmpeg (system) | Probe/assemble/validate media | n/a |

Local-first: unpaid/mocked paths must run without OmniChar/ReelMimic/YouTube credentials.

---

## 6. Local development flow

1. `npm install`
2. `cp .env.example .env`
3. `npm run doctor`
4. `npm test`
5. `npm run cli -- workflow status` (foundation stub)
6. Optional: install OmniChar / ReelMimic per their READMEs and set `*_BASE_URL`

---

## 7. Production flow (target daily workflow)

```
Trend discovery → score/select → original story → character resolve
  → storyboard → selected backend (ReelMimic, OpenMontage, or offline fixture) → audio → captions
  → thumbnail → QA (PASS|WARN|BLOCK) → schedule/publish
  → analytics ingest → controlled learning → next decision
```

Supervisor enforces state machine transitions, budgets, kill switch, and QA BLOCK = no publish.

---

## 8. Data flow

```
config/channels/*.yaml  → ChannelConfig
characters/*/           → CharacterRegistry
references/             → ReferenceAnalyzer input (patterns only)
projects/<id>/          → story, storyboard, reference-analysis.json, assets
generated/              → intermediate renders
published/              → publish manifests + idempotency keys
analytics/              → snapshots + recommendations (pending until approved)
data/                   → SQLite/state (planned), tokens (gitignored)
logs/                   → structured JSON logs
```

References inform **technique/structure**, not cloning of protected expression.

---

## 9. Security considerations

- No secrets in git; `.env` gitignored; `.env.example` placeholders only
- YouTube OAuth tokens stored under `data/` with restrictive permissions
- Global kill switch `TOONFORGE_KILL_SWITCH`
- Publish idempotency key = `projectId` / `videoId`
- QA `BLOCK` prevents publish
- OmniChar GPL kept out-of-process
- Content policy: no third-party footage/music reuse without license; no distinctive copyrighted character recreation; no celebrity impersonation
- Least-privilege GitHub tokens for CI/auto-merge tooling

---

## 10. Failure / retry model

Typed errors: `{ code, message, component, retryable, cause, context }`.

| Class | Retry? |
|-------|--------|
| Network / rate limit / timeout | yes (bounded) |
| Budget exceeded / kill switch / QA BLOCK / policy | no |
| Unknown YouTube upload outcome | no automatic re-upload; reconcile first |
| Upstream unavailable | fail cleanly; mark adapter `unavailable` |

Max retries and cooldowns come from config. Supervisor transitions: `FAILED → RETRYING → last_valid_state`.

---

## 11. Workflow state machine

```
IDEA → RESEARCHING → ANALYZING → STORY_GENERATED → STORYBOARD_READY
  → PRODUCTION → AUDIO → ASSEMBLY → QA → READY_TO_PUBLISH
  → SCHEDULED → PUBLISHED → ANALYZING → COMPLETE

Any → FAILED → RETRYING → (previous valid state)
```

Required transitions cannot be skipped.

---

## 12. What this foundation delivers vs stubs

| Delivered now | Stubbed / deferred |
|---------------|--------------------|
| Architecture + notices + dependency matrix | Full Trend/Story/Production implementations |
| Core IDs, errors, logging, retry, policies, state machine | Real OmniChar/ReelMimic/Ruflo process clients |
| Adapter **interfaces** + availability probes | YouTube OAuth upload |
| Channel config schema + sample | Scheduler cron runner |
| Character registry types + seed character metadata | MCP tool server wiring |
| CLI `doctor` / basic commands | E2E mocked cartoon pipeline (next phases) |
| Unit tests + CI workflow | Docker compose (later phase) |

Never treat stubs as completed integrations.
