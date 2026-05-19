---
name: deploy-check
description: Pre-push validation. Runs format → typecheck → lint → build → cost-budget audit. Use before every commit. Required by autonomous-build-loop.
---

# Deploy check

Single command that runs the full pre-push validation.

## What it does

1. `pnpm prettier --check .` — formatting
2. `pnpm typecheck` — TypeScript strict
3. `pnpm lint` — ESLint
4. `pnpm build` — Next.js production build
5. Cost-budget audit — `pnpm tsx scripts/cost-budget-audit.ts`

If any step fails, print the error + exit non-zero.

## Cost-budget audit

Runs:

```sql
SELECT job, SUM("costUsd") AS spend_last_24h
FROM "CronRun"
WHERE "startedAt" > NOW() - INTERVAL '24 hours'
GROUP BY job
ORDER BY spend_last_24h DESC;
```

For each job, compare to `docs/data-cadence.md` expected ceiling.

If any job is >2× expected:
- Yellow warning in output
- Add a note to `.claude/memory/build-log.md` for review
- Don't block the build (but flag)

If any job is >5× expected:
- Red alert
- BLOCK the deploy check
- Suggest reviewing the cron handler for runaway loop

## When to run

- After every code change before commit
- Auto-invoked by `autonomous-build-loop`
- Manually after pulling from main (sanity check)
- As pre-commit hook (configurable in `.husky/pre-commit`)

## Output format

```
✓ Format       (0.3s)
✓ Typecheck    (4.2s)
✓ Lint         (1.8s)
✓ Build        (28.7s)
✓ Cost audit   (last 24h: $1.23 — within budget)

Deploy check passed in 35.0s
```

Or on failure:

```
✓ Format       (0.3s)
✓ Typecheck    (4.2s)
✗ Lint         (1.8s)

modules/hunter/filters.ts:42:5
  '_unused' is defined but never used  no-unused-vars

Deploy check FAILED — fix above before committing
```
