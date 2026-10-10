# Integration / Dependency Matrix

Audited 2026-10-07. Status values:

- `available` — repo reachable and inspected
- `resolved` — URL corrected from brief
- `blocked` — cannot integrate as requested
- `interface-only` — ToonForge adapter interface present; runtime client not wired
- `guidance-only` — concepts adapted; no runtime dependency

| Component | Upstream | Status | Entry points (verified) | Credentials / config needed | Adapter path | Notes |
|-----------|----------|--------|-------------------------|-----------------------------|--------------|-------|
| Character engine | OmniChar | available + **GPL risk** | `core/webui.sh`, `python main.py`, HTTP `/v1/*` @8848 | Local models dir; optional GPU | `src/adapters/omnichar/` | Out-of-process only |
| Production | ReelMimic | available | `./install.sh`, `./start.sh`, HTTP @4318; `analyze.py` | Claude Code or Codex login; FFmpeg; Node 22.18+ | `src/adapters/reelmimic/` | File-based job contract |
| Production (optional) | OpenMontage | available + **AGPL** | `tools/character/character_animation.py` tool `execute()`; commit `9327439` | Separate checkout, Python ≥ 3.10, FFmpeg; Playwright for preview MP4 | `src/adapters/openmontage/` | Process runner only. Not vendored. |
| Planning policies | andrej-karpathy-skills | available / license unclear | `CLAUDE.md`, `CURSOR.md` | none | `src/adapters/karpathy-skills/` + `src/core/policies/` | guidance-only |
| YouTube | darkzOGx/youtube-automation-agent | **resolved** (was `...-`) | `npm start`, `agents/publishing-scheduling-agent.js`, googleapis | YouTube OAuth desktop client, token path | `src/adapters/youtube/` | interface-only initially |
| Orchestration | Ruflo | available | `npx ruflo@latest mcp start`, `ruflo` bin | optional | `src/adapters/ruflo/` | local fallback required |

## Capability requirements (YouTube adapter)

Even without wrapping AgentTube, ToonForge needs:

1. OAuth authenticate / token refresh  
2. Validate metadata (title, description, privacy, thumbnail)  
3. Upload with idempotency / reconciliation  
4. Schedule publish time  
5. Fetch video status  
6. Fetch analytics snapshots  
7. Pause publishing (global or per channel)

## Future plug-in point

`src/adapters/youtube/index.ts` exports `createYoutubeAdapter(config)`.  
Swap `StubYoutubeAdapter` → `GoogleApisYoutubeAdapter` → optional `AgentTubeBridgeAdapter` without changing engines.
