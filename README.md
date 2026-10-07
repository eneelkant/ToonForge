# ToonForge

Turn trends into **original** animated videos — automatically.

Local-first, modular, autonomous cartoon production and YouTube publishing platform.

> **Foundation status:** architecture audit + adapter interfaces + core runtime foundations.  
> Full production integrations (OmniChar encode, ReelMimic produce, YouTube OAuth upload) are intentionally stubbed and documented.

## Quick start

```bash
npm install
cp .env.example .env
npm run doctor
npm test
npm run cli -- characters list
npm run cli -- system status
```

## Docs

- [Architecture](docs/architecture.md)
- [Dependency matrix](docs/integrations/dependency-matrix.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [GitHub development](docs/github-development.md)

## Upstream engines (adapters only)

| Role | Upstream | Notes |
|------|----------|--------|
| Characters | [OmniChar](https://github.com/omnichar/OmniChar) | GPL — process/HTTP isolation only |
| Production | [ReelMimic](https://github.com/edenfunf/reelmimic) | MIT — local HTTP + file contract |
| Guidance | [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) | Guidance mapped into policies |
| YouTube | [youtube-automation-agent](https://github.com/darkzOGx/youtube-automation-agent) | MIT — URL without trailing dash |
| Orchestration | [Ruflo](https://github.com/ruvnet/ruflo) | MIT — optional; local fallback included |

## Safety

- Global kill switch: `TOONFORGE_KILL_SWITCH`
- Budgets, retries, QA PASS/WARN/BLOCK
- Publish idempotency keys
- Originality / no third-party footage reuse without license

## License

Apache-2.0 — see `LICENSE` and `THIRD_PARTY_NOTICES.md`.
