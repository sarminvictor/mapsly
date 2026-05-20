# MEMORY · Viktor's preferences and learned context

Read at the start of every session. Append carefully — this is the long-term memory of how Viktor likes to work.

## Hard preferences

- **Pro Max 20x only.** Never the Anthropic API. The plan is paid; idle quota is wasted.
- **Auto-merge is default.** When gates pass, ship to main without waiting for review.
- **Mapsly stops at "qualified lead."** No outreach automation in v1.
- **Performance is the #1 requirement.** Slow = broken.
- **One step at a time when Viktor is watching.** Don't batch unrelated work into one walkthrough; pause between distinct setup steps for confirmation.
- **Recommend, never ask.** Research the answer yourself; present recommendations with reasoning. Avoid open-ended "what should we do?" questions.
- **Never expose internal file paths** (sandbox paths like `/sessions/...`) to Viktor. Use the user-facing path or just "the project folder".

## Style of work

- Score everything · 5-dim scorecard appended to PLAN.md per phase.
- Phased plans · one phase = one session = one PR.
- Scale to complexity · a typo fix doesn't need 5 research agents.
- Always commit + push at end of session, even partial work.

## What's been built

(Updated by autonomous-build-loop on every successful merge. Most recent first.)

- **2026-05-20 · C.1 · Cost-counter + CronRun lifecycle (PR #6 · v0.6.9 · score 8.4/10)** — `lib/cost/cost-counter.ts` + `lib/middleware/no-live-api.ts` + 32 tests. AsyncLocalStorage binds a CronRun to all async ops; `withCostCounter(operation, unitCost, fn)` throws if no CronRun open (the "no live API in user request path" enforcement). cronHandler wrapper adds Bearer CRON_SECRET auth + OK/PARTIAL + itemsProcessed/meta writeback. INC-32 logged: Prisma `{ increment }` over NULL nullable column stays NULL — fix is explicit `costUsd: 0` in openCronRun.

### 2026-05-20

- **B.0 · Design system primitives** (v0.6.8 · PR #5) — `components/ui/{Button,Input,Card,Tile,Pill,Modal}.tsx` + `lib/ui/cn.ts`. Audience-aware (smb/agency) palette via prop. Modal is the only client component (state + keyboard). Score 8.8/10. Unblocks B.1–B.9 marketing pages, E.0 SMB component library, F.0 Agency component library.
