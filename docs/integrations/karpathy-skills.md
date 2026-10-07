# Karpathy Skills Integration Notes

- Upstream: https://github.com/multica-ai/andrej-karpathy-skills
- LICENSE file: missing at audit; README claims MIT; GitHub license null
- Adapter: guidance mapping only

## Principles mapped into ToonForge

| Upstream | ToonForge |
|----------|-----------|
| Think Before Coding | `policies/plan.ts` |
| Simplicity First | `policies/simplicity.ts` |
| Surgical Changes | `policies/surgical.ts` |
| Goal-Driven Execution | `policies/verify.ts` |

Supervisor runs PLAN → CHECK → EXECUTE → VERIFY before irreversible actions (publish, paid generation, strategy mutation).
