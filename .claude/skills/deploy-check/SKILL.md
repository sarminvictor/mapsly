---
name: deploy-check
description: Pre-push validation. Runs format → typecheck → lint → migrate-status → build via `pnpm deploy-check`. Use before every commit. Required by autonomous-build-loop.
---

# Deploy check

Single command: `pnpm deploy-check`. Documents the REAL script — keep this file in sync with `package.json`.

## What it actually runs

`"deploy-check": "pnpm format && pnpm typecheck && pnpm lint && pnpm db:status && pnpm build"`

1. `pnpm format` — `prettier --write .` · rewrites files in place (NOT `--check`). If it reformats anything, those changes belong in the commit.
2. `pnpm typecheck` — `tsc --noEmit`, strict.
3. `pnpm lint` — `eslint .`
4. `pnpm db:status` — `prisma migrate status` · fails on drift between local migrations and Neon (INC-23 prevention). Needs `DATABASE_URL`/`DIRECT_URL` in the environment.
5. `pnpm build` — `prisma generate && next build`.

If any step fails, the chain stops and exits non-zero. Fix and re-run.

## Cost-budget audit · TODO — script not yet written

`scripts/cost-budget-audit.ts` does not exist yet, so no cost gate runs in deploy-check. Intended behavior once written: sum last-24h `CronRun."costUsd"` per job, compare to `docs/data-cadence.md` ceilings, warn at >2×, block at >5×. Until then, use the `/cost-audit` skill for a manual last-7d check.

## When to run

- After every code change, before commit
- Auto-invoked by `autonomous-build-loop`
- After pulling from main (sanity check)

## Output format

```
✓ Format          (prettier --write)
✓ Typecheck       (tsc --noEmit)
✓ Lint            (eslint)
✓ Migrate status  (no drift)
✓ Build           (next build)

Deploy check passed
```

On failure, print the failing step's error verbatim and stop:

```
✓ Format
✓ Typecheck
✗ Lint

modules/hunter/filters.ts:42:5
  '_unused' is defined but never used  no-unused-vars

Deploy check FAILED — fix above before committing
```
