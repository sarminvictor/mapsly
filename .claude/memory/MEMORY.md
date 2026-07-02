# MEMORY · Viktor's preferences and learned context

Read at the start of every session. Append carefully — this is the long-term memory of how Viktor likes to work.

## Hard preferences

- **Pro Max 20x only.** Never the metered API. The plan is paid; idle quota is wasted.
- **NO commit/push without Viktor approval.** Push to gitlab `main` = production deploy. GitLab is primary, GitHub is a mirror. The GitHub-targeted `/loop` stays paused.
- **Viktor tests UI manually in the browser** — no automated browser checks in interactive sessions; verify at code level, then wait for his report.
- **Reviewer scores are informational**, not merge gates.
- **Mapsly stops at "qualified lead."** No outreach automation in v1.
- **Performance is the #1 requirement.** Slow = broken.
- **One step at a time when Viktor is watching.** Don't batch unrelated work into one walkthrough; pause between distinct setup steps for confirmation.
- **Recommend, never ask.** Research the answer yourself; present recommendations with reasoning. Avoid open-ended "what should we do?" questions.
- **Never expose internal file paths** (sandbox paths like `/sessions/...`) to Viktor. Use the user-facing path or just "the project folder".

## Style of work

- Score everything · 5-dim scorecard appended to PLAN.md per phase.
- Phased plans · one phase = one session = one PR.
- Scale to complexity · a typo fix doesn't need 5 research agents.
- Leave work uncommitted at end of session; show results and wait for Viktor's approval before any push.

## What's been built

(Updated by autonomous-build-loop on every successful merge. Most recent first.)

- **2026-05-20 · D.2 · Mapsly Score formula · 6-dim weighted composite (PR #17 · v0.6.19 · score 9.60/10)** — `modules/scoring/{types,sub-scores,mapsly-score,index}.ts` + 56-case test suite. Pure-compute module: weights frozen with module-load self-check (sum=1.0); reputation 25% / communication 15% / profileCompleteness 15% / trust 15% / pricingTransparency 10% / brandPresence 20%. `clamp01` collapses NaN/Infinity/negative/above-1 defensively; `computeMapslyScoreBreakdown` returns frozen per-dim contribution table. Sub-score derivation helpers (rating+volume+velocity for reputation, replyRate+latency for communication, etc.) feed the cron path (C.9 persists composite to `BusinessSnapshot.mapslyScore`). Unblocks D.3/D.5/E.1/C.9.

- **2026-05-20 · E.0 · SMB component library · 4 audience-specific components (PR #13 · v0.6.15 · score 7.5/10)** — `modules/smb-dashboard/components/{KPITile,AlertCard,FixCard,ScoreBreakdown,index}.ts` + `app/globals.css` tokens. Maria-facing primitives built on B.0. KPITile has hero (56px) + standard (32px) serif variants; info-tip is a focusable `<button>` (keyboard a11y); AlertCard role='status' is opt-in via `live` prop (no AT spam at page load); ScoreBreakdown uses `role='progressbar'` + valuenow/min/max; FixCard prop is `action` (not `title` — would collide with native HTML `title` attribute, TS2430). Added `--color-info`/`--color-gold-2`/`--color-success-2` tokens + global `prefers-reduced-motion` rule. Server-component-safe. Unblocks E.1 (SMB dashboard page), E.2 (reviews), E.4 (audit pages).

- **2026-05-20 · D.1 · Signal registry · 74 signals across 8 categories (PR #11 · v0.6.13 · score 9.6/10)** — `modules/signals/{registry,types,comparators,categories,index}.ts` + comparator-semantics unit tests. SignalDefinition shape (key/label/help/category/type/comparators/source/cadence/column/isExclusion) is the moat data structure. Discriminated comparator unions, exhaustive never-checks, defensive coercion helpers (toNumber/toBoolean/toDate). Object.freeze on SIGNALS map. FilterValue union widened on resume to accept Date scalars + [Date,Date] tuples + readonly unknown[] for tests. Follow-ups: registry.test.ts asserting SIGNAL_COUNT/column-format invariants, populate costPerRefreshUsd field, wire into modules/hunter/groups.ts (F.2).
- **2026-05-20 · C.1 · Cost-counter + CronRun lifecycle (PR #6 · v0.6.9 · score 8.4/10)** — `lib/cost/cost-counter.ts` + `lib/middleware/no-live-api.ts` + 32 tests. AsyncLocalStorage binds a CronRun to all async ops; `withCostCounter(operation, unitCost, fn)` throws if no CronRun open (the "no live API in user request path" enforcement). cronHandler wrapper adds Bearer CRON_SECRET auth + OK/PARTIAL + itemsProcessed/meta writeback. INC-32 logged: Prisma `{ increment }` over NULL nullable column stays NULL — fix is explicit `costUsd: 0` in openCronRun.

### 2026-05-20

- **B.0 · Design system primitives** (v0.6.8 · PR #5) — `components/ui/{Button,Input,Card,Tile,Pill,Modal}.tsx` + `lib/ui/cn.ts`. Audience-aware (smb/agency) palette via prop. Modal is the only client component (state + keyboard). Score 8.8/10. Unblocks B.1–B.9 marketing pages, E.0 SMB component library, F.0 Agency component library.
