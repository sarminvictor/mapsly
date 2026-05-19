---
description: Quality bar for every change. Auto-loaded for API routes and modules.
globs: ["app/api/**/*.ts", "modules/**/*.ts", "modules/**/*.tsx", "lib/**/*.ts"]
alwaysApply: true
---

# Quality checklist

Before marking a task done:

## Functionality
- [ ] Happy path works end-to-end (test it via `pnpm dev`)
- [ ] All error states handled (network error, validation fail, not-found)
- [ ] Loading states present where async data renders
- [ ] Empty states present (e.g. "no leads in this list yet")

## Types
- [ ] No `any`, no `as unknown as X`
- [ ] All inputs validated with Zod
- [ ] Discriminated unions for state shapes

## Data
- [ ] No live API calls in user request path
- [ ] Database queries use `select` deliberately — no `findMany()` without explicit fields
- [ ] Cache tags on every cacheable response
- [ ] If you read aggregates, they come from `BusinessSnapshot` or similar — not recomputed live

## Security
- [ ] User input sanitized + validated
- [ ] Auth check via `auth()` at top of route — `unauthorized()` if missing
- [ ] Rate-limit applied on user-facing routes
- [ ] Cron routes verify `CRON_SECRET`
- [ ] No secrets logged
- [ ] No PII in URL params

## Cost
- [ ] If this calls an external API, it's wrapped by `services/{vendor}` cost-counter
- [ ] If this is a cron job, it opens + closes a `CronRun` row
- [ ] No call in user path that would charge per invocation

## UX
- [ ] Mobile responsive (test 380px viewport)
- [ ] Jargon explained with `info-tip` tooltips (especially: LCP, CLS, schema, NAP, local 3-pack, MSI)
- [ ] Color-coded states use the project palette tokens
- [ ] Loading + empty + error states all rendered

## Tests
- [ ] Unit test for any non-trivial logic
- [ ] Integration test for any new API route
- [ ] No tests deleted without replacement

## Before push
- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm build` succeeds
- [ ] `/deploy-check` skill passes
- [ ] Commit message in conventional form

## After push
- [ ] Vercel preview deploy looks correct
- [ ] No new Sentry errors in preview
- [ ] Updated CLAUDE.md Feature Map if status changed
