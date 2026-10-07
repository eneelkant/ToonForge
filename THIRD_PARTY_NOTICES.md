# Third-Party Notices

ToonForge itself is licensed under the **Apache License 2.0** (see `LICENSE`).

This file documents upstream projects inspected for integration. License claims below are based on **files and GitHub metadata inspected on 2026-10-07**. Do not treat this as legal advice.

ToonForge does **not** vendor upstream source trees into this repository in the foundation phase. Adapters call external processes/APIs where integration is needed.

---

## 1. OmniChar

| Field | Value |
|-------|--------|
| Repository | https://github.com/omnichar/OmniChar |
| Role in ToonForge | Character consistency / `.char` format / optional local generation |
| License file inspected | `LICENSE` — **GNU GPL v3** |
| package.json / pyproject | `GPL-3.0-or-later` |
| GitHub licenseInfo | `gpl-3.0` |
| Copyright | As stated in upstream LICENSE / project headers |

### Integration posture

- **Compatible approach:** optional out-of-process / HTTP client only.
- **Not done:** copying OmniChar source into ToonForge, or linking `inline_core` as a library inside the Apache-2.0 package.
- **Risk:** combining and distributing OmniChar with ToonForge may trigger GPL copyleft obligations for the combined work. Keep OmniChar optional and isolated; operators who enable it must accept upstream GPL terms.

### Attribution

When OmniChar is used at runtime, operators should retain OmniChar’s copyright and GPL notices from the OmniChar installation. ToonForge documents the dependency here and in `docs/integrations/omnichar.md`.

---

## 2. ReelMimic

| Field | Value |
|-------|--------|
| Repository | https://github.com/edenfunf/reelmimic |
| Role in ToonForge | Reference analysis, storyboard/production workflow |
| License file inspected | `LICENSE` — **MIT** (Copyright (c) 2026 ReelMimic contributors) |
| Additional notices | `THIRD_PARTY_NOTICES.md` lists bundled Apache-2.0 and MIT skills/assets |
| GitHub licenseInfo | `mit` |

### Integration posture

- Prefer HTTP/file-contract adapter against a local ReelMimic install.
- If any ReelMimic or bundled skill files are later copied into ToonForge, preserve MIT/Apache notices from upstream `LICENSE` / `THIRD_PARTY_NOTICES.md` / `LICENSES/`.

---

## 3. andrej-karpathy-skills

| Field | Value |
|-------|--------|
| Repository | https://github.com/multica-ai/andrej-karpathy-skills |
| Role in ToonForge | Agent operating guidance (PLAN → CHECK → EXECUTE → VERIFY) |
| LICENSE file | **Not present** in repository root at audit time |
| README claim | Section “License” states `MIT` |
| GitHub licenseInfo | `null` |

### Integration posture

- Translate principles into ToonForge-owned policy text under `src/core/policies/`.
- Do **not** claim a verified MIT grant until a LICENSE file (or other clear grant) is present upstream.
- Do not copy the upstream markdown wholesale without license clarity.

---

## 4. youtube-automation-agent (AgentTube / Lumen)

| Field | Value |
|-------|--------|
| Requested URL | `https://github.com/darkzOGx/youtube-automation-agent-` (**unreachable** — trailing dash) |
| Resolved repository | https://github.com/darkzOGx/youtube-automation-agent |
| Role in ToonForge | Reference for YouTube OAuth, scheduling, upload idempotency, analytics patterns |
| License file inspected | `LICENSE` — **MIT** (Copyright (c) 2025 YouTube Automation Agent Contributors) |
| GitHub licenseInfo | `mit` |

### Integration posture

- Implement ToonForge `YoutubeAdapter` against YouTube Data API v3 using env-based OAuth.
- Optionally study AgentTube patterns; do not merge the entire application.
- Preserve MIT notice if any AgentTube code is later adapted.

### Unavailable note (historical)

The trailing-dash URL from the original brief does not resolve. Integration is **not** blocked: the corrected URL is available.

---

## 5. Ruflo

| Field | Value |
|-------|--------|
| Repository | https://github.com/ruvnet/ruflo |
| npm packages inspected | `ruflo`, `claude-flow` (v3.54.0 at audit) |
| Role in ToonForge | Optional orchestration / memory / MCP harness |
| License file inspected | `LICENSE` — **MIT** (Copyright (c) 2024-2026 ruvnet) |
| GitHub / npm license | MIT |

### Integration posture

- Optional dependency behind `adapters/ruflo`.
- Local workflow runner is the development fallback when Ruflo is disabled/unavailable.
- Preserve MIT notice if Ruflo code is vendored or substantially copied.

---

## License compatibility summary

| Upstream | License | Apache-2.0 ToonForge distribution |
|----------|---------|-----------------------------------|
| OmniChar | GPL-3.0-or-later | **Process isolation only**; do not combine into a single proprietary/Apache binary without legal review |
| ReelMimic | MIT (+ Apache bundled skills) | Compatible with attribution |
| Karpathy skills | Unverified (README MIT only) | Use as guidance; avoid redistribution until clarified |
| youtube-automation-agent | MIT | Compatible with attribution |
| Ruflo | MIT | Compatible with attribution |

---

## Updates

When an adapter begins shipping upstream code or binaries, update this file with exact paths, versions/commits, and required notices before merge.
