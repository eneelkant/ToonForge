# Operations overview

## Kill switch

Set `TOONFORGE_KILL_SWITCH=true` to block irreversible supervisor actions.

## Budgets

- `TOONFORGE_DAILY_BUDGET_USD`
- `TOONFORGE_PER_VIDEO_BUDGET_USD`
- `TOONFORGE_MAX_CONCURRENT_JOBS`
- `TOONFORGE_MAX_RETRIES`

## Doctor

```bash
npm run doctor
```

Checks Node, Python, FFmpeg, Git, optional `gh`, writable dirs, adapter probes.

## Publishing safety

- QA must not be `BLOCK`
- Idempotency key `pub:<projectId>:<videoId>`
- Default privacy: private
