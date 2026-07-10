# Incidents · the institutional memory

Append-only log of failures + their preventions. Read first on every session.

See `.claude/rules/incident-prevention.md` for the rules, including the archival
policy: entries whose prevention is fully absorbed by a rule file are compacted
to one-line stubs below — full text lives in `incidents-archive.md` (grep on demand).

---

## Archived index

Full entries in `.claude/memory/incidents-archive.md` · `grep -n "INC-NN" incidents-archive.md`.
No INC-21 exists (numbering gap in the original log).

- INC-01 · sandbox can't unlink stale .git/index.lock → archive + superseded by INC-31
- INC-02 · Prisma 7 forbids `url` in datasource block → archive + prisma.md §1
- INC-03 · PrismaNeon takes PoolConfig, not `new Pool()` → archive + prisma.md §2
- INC-04 · vitest fails CI with zero tests → archive + `--passWithNoTests` in package.json
- INC-05 · ESLint 9 FlatCompat circular JSON → archive + eslint.config.mjs (no FlatCompat)
- INC-06 · Vercel build skips `prisma generate` → archive + prisma.md §4 · vercel.md §2
- INC-07 · module-load env access crashes Vercel build → archive + prisma.md §3 · vercel.md §3
- INC-08 · Neon adapter can't deserialize `name` columns → archive + prisma.md §5a · mcp-postgres.md
- INC-09 · cacheComponents forbids `new Date()` in RSC → archive + performance.md §PPR · cache-components.md
- INC-10 · commit email must match a GitHub account → archive + vercel.md §1 · git-discipline.md
- INC-12 · `vercel link` required before env/deploy → archive + vercel.md §4
- INC-13 · revalidateTag requires cacheLife profile arg → archive + prisma.md §8 · caching.md
- INC-14 · Cowork FUSE mount blocks unlink() → archive + superseded by INC-31
- INC-16 · loop ran on default model, not Opus → archive + CLAUDE.md model pin · loop-discipline.md
- INC-17 · sandbox rsync clobbered loop-lock → archive + superseded by INC-31
- INC-18 · fabricated Pro Max usage card → archive + loop-discipline.md (honest telemetry, 3-layer quota recovery)
- INC-19 · headless claude needs --dangerously-skip-permissions → archive + superseded by INC-31
- INC-20 · launchd ran a stale wrapper copy → archive + superseded by INC-31
- INC-22 · scheduler pivot launchd → /loop → archive + superseded by INC-31
- INC-23 · schema drift: column never pushed to Neon → archive + prisma.md §6 (recurred as INC-37; see INC-42)
- INC-25 · NEXT_PHASE guard shapes must be 100% complete → archive + cache-components.md Pattern 1
- INC-26 · t.rich() render props don't serialize → archive + cache-components.md Pattern 4a
- INC-27 · Vercel build can't open Neon WebSockets → archive + cache-components.md Pattern 1 · vercel.md §5
- INC-28 · INC-14 false-positive on real macOS → archive + superseded by INC-31
- INC-29 · Cowork FUSE wall blocks pnpm install → archive + superseded by INC-31 · loop-discipline.md §1
- INC-30 · capability gaps never halt the loop → archive + capability-routing.md
- INC-31 · Cowork-canonical: loop runs from /tmp → archive + loop-discipline.md §1 · loop.md STEP 0
- INC-32 · Prisma `{ increment }` over NULL stays NULL → archive + prisma.md §5b
- INC-33 · /tmp orphans exhaust sandbox disk → archive + loop-discipline.md §2–3
- INC-34 · host disk exhaustion kills sandbox bash → archive + loop-discipline.md §4
- INC-35 · 100-turn cap · v0.6.42 turn-budget mitigations → archive + loop-discipline.md · compound-steps.md
- INC-36 · prose guidance ≠ behavior change → archive + compound-steps.md · no-verify.md
- INC-38 · parent-delegates-everything architecture → archive + loop.md v0.7.4 (subagent delegation)
- INC-39 · subagent registration + Write-cwd mismatch → archive + loop.md v0.7.7
- INC-40 · function props across 'use client' boundary → archive + cache-components.md Pattern 4b

---

### INC-2026-05-19-11 · `app/page.tsx` 404s because next-intl middleware rewrites `/` to a missing locale path

**Status:** ✅ FIXED + ENCODED — `app/[locale]/` restructure shipped; root `/` redirects via next-intl middleware.

**Symptom:** `https://www.mapsly.ai/` returns HTTP 404 despite `app/page.tsx` existing. `dev.mapsly.ai/` returns 200 (because middleware bypasses next-intl for that host).

**Root cause:** `createMiddleware(routing)` from next-intl with `localePrefix: "as-needed"` rewrites `/` → an internal `/{detected-locale}` path. Without `app/[locale]/page.tsx`, that path 404s. The top-level `app/page.tsx` is unreachable.

**Fix applied:** Move `app/page.tsx` → `app/[locale]/page.tsx` and add `app/[locale]/layout.tsx` that calls `setRequestLocale(locale)`. Keep `app/layout.tsx` as the root `<html>`-bearing layout. Route groups like `app/(dev)/` remain outside the locale tree (correct — they're served by middleware host rewrites).

**Prevention:** Any new Next + next-intl scaffold creates `app/[locale]/page.tsx` from day one. Add a CI grep that fails if `app/page.tsx` exists alongside any `app/[locale]/` directory (one or the other, never both).

**Where encoded:** `.claude/rules/i18n.md` (to be augmented with structure rule), this file.
**Confidence:** high
**Tags:** next-intl, app-router, routing

### INC-2026-05-19-15 · next-intl middleware matcher excludes paths with dots

**Status:** ✅ FIXED + ENCODED — `middleware.ts` matcher updated; `.claude/rules/i18n.md` matcher pattern documented.

**Symptom:** Routes containing a dot in the URL (like `/tasks/A.1`, `/tasks/1.10.4`) return 404 on `dev.mapsly.ai`. The same paths work locally (`pnpm dev`) but 404 in production.

**Root cause:** The middleware config matcher pattern `/((?!api|_next|_vercel|.*\..*).*)` excludes any URL containing a dot — designed to skip static assets (`.css`, `.png`, etc.) but too greedy: `A.1` matches the same regex. With matcher skipped, the host-based rewrite in `middleware.ts` doesn't fire, so `dev.mapsly.ai/tasks/A.1` is served as-is — but only `/dev/tasks/[id]` exists, not `/tasks/[id]`.

**Fix applied:** Tightened the matcher exclusion to a specific extension list:

```ts
matcher: [
  "/((?!api|_next|_vercel|.*\\.(?:css|js|mjs|json|webmanifest|map|ico|png|jpg|jpeg|gif|svg|webp|avif|woff|woff2|ttf|otf|eot|mp4|webm|mp3|wav|pdf|txt|xml|zip)).*)",
],
```

Now only real static-asset extensions are excluded; arbitrary dotted paths flow through middleware as expected.

**Prevention:** Any time a route uses task IDs / SKUs / version strings with dots, the matcher must allow them. The "exclude any dot" pattern is a Next.js docs default but unsafe for dynamic-segment IDs. Pin matchers to known extensions only.

**Where encoded:** `middleware.ts`, this file.
**Confidence:** high
**Tags:** next-intl, middleware, routing, dynamic-segments

### INC-2026-05-20-24 · In-flight card lies "live · in progress" when TaskRun is PARTIAL/FAILED

**Status:** ✅ FIXED + ENCODED — `app/(dev)/dev/queries/in-flight.ts` reads TaskRun.outcome strictly.

**Symptom:** After B.6 shipped as PARTIAL (PR opened, awaiting review), the dashboard's In-flight card kept showing "live · in progress" with a pulsing green dot for B.6 — even though no agent was actively running.

**Root cause:** `queries/in-flight.ts` selected any `Task.status='IN_PROGRESS'` and treated it as "live." But Task.status stays IN_PROGRESS while a PR awaits human review (correct convention — work isn't fully done until merged). The "live" indicator was conflating "Task in flight" with "agent actively running."

**Fix applied:** `getInFlight` now requires BOTH `Task.status='IN_PROGRESS'` AND at least one `TaskRun.outcome='IN_PROGRESS'`. Without both, falls through to the "most recent finished run" display.

**Prevention:**

1. UI indicators for "live" / "active" / "running" must check the lowest-level signal (TaskRun.outcome=IN_PROGRESS), not aggregate states.
2. Document Task.status semantics in `prisma/schema.prisma` comments: `IN_PROGRESS` covers "claimed and either actively running OR awaiting PR review." Use TaskRun.outcome to distinguish.

**Where encoded:**

- `app/(dev)/dev/queries/in-flight.ts`
- this file

**Confidence:** high
**Tags:** dashboard, in-flight, status-conflation, ux-honesty

### INC-2026-05-21-37 · Dashboard "no tasks · run pnpm seed:plan" — schema drift hiding behind swallow-catch (recurrence of INC-23)

**Status:** ✅ FIXED + ENCODED — v0.7.2: (1) `ALTER TABLE "Task" ADD COLUMN "contextBundle" JSONB` applied to Neon, (2) `app/(dev)/dev/queries/plan.ts` uses explicit `select` instead of broad `include` so future additive schema changes don't break the dashboard, (3) catch now surfaces the error to the page instead of silently returning total=0.

**Symptom:** `https://dev.mapsly.ai/tasks` displayed `no tasks in DB · run pnpm seed:plan` while Postgres actually held **81 active tasks** (52 DONE, 26 PENDING, 2 HUMAN_REQUIRED, 1 IN_PROGRESS) across 9 TaskGroups. Loop was still shipping (v0.7.1 just merged B.5), proving tasks exist.

Viktor: _"where all our task gone?"_

**Root cause:** v0.7.0 added `Task.contextBundle Json?` to `prisma/schema.prisma`. Vercel built with `prisma generate` so the deployed Prisma client included `contextBundle` in the default field set. But `prisma db push` was NEVER run against Neon (per `.claude/rules/prisma.md` § 6 schema-drift workflow — `prisma migrate dev` writes a migration file, `prisma db push` applies to remote, both are out-of-band from `next build`). The deployed app's `prisma.taskGroup.findMany({ include: { tasks: ... } })` issued a SELECT containing `t."contextBundle"` → Neon returned `column "contextBundle" does not exist` → Prisma threw → `app/(dev)/dev/queries/plan.ts`'s broad `} catch { return { total:0, ... } }` swallowed it → the page rendered the misleading empty-state message.

Identical mechanism to **INC-23** (TaskRun.resumedFromRunId added but never pushed to Neon → /tasks/[id] returns 404). Prevention there said "any schema PR must `pnpm prisma migrate status` before merging" — that prevention did NOT hold for v0.7.0 because the column was added directly to schema.prisma in a sandbox commit without the local prisma toolchain available to run migrate-status.

**Fix applied (v0.7.2):**

1. Ran `ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "contextBundle" JSONB` directly on Neon via the @neondatabase/serverless driver from the sandbox. Idempotent. Confirmed `information_schema.columns` shows the column with `data_type = jsonb`.
2. **`app/(dev)/dev/queries/plan.ts`**: replaced `include: { tasks: ... }` with explicit `select: { id, name, description, domain, sortOrder, tasks: { select: { id, title, effort, status, deps, tags } } }`. Now only the columns the dashboard actually renders are fetched. Future additive schema changes can be applied to Prisma client without breaking the deployed query.
3. **`app/(dev)/dev/queries/plan.ts`**: catch block now `console.error`s + returns `error: string` field on the PlanSummary instead of silently zeroing. `PlanSummary` interface gets `error?: string`.
4. **`app/(dev)/dev/tasks/page.tsx`**: detects `plan.error` and renders an actionable message ("tasks query failed — {error}. Likely schema drift, see INC-23/INC-37.") instead of the misleading empty state.

**Prevention (stronger than INC-23):**

1. **Use `select` over `include` in dashboard queries.** Broad includes auto-include EVERY column on the model, including ones added since the deployed `prisma generate` ran. Explicit `select` lists only what we render — additive schema changes don't break the query. Add to `.claude/rules/prisma.md`.

2. **Never silently swallow Prisma errors.** Catches that return zero/empty must record the error and surface it to the UI. Otherwise schema drift = invisible regression. Add to `.claude/rules/observability.md` (or new `.claude/rules/error-handling.md`).

3. **Schema-change PR checklist:** any PR that adds a column to `prisma/schema.prisma` MUST include either (a) a `prisma/migrations/<timestamp>_<name>/migration.sql` file with the ALTER TABLE, OR (b) an explicit comment on the PR describing the manual `prisma db push` that will be run before merge. Add to `.claude/rules/prisma.md` § 6.

4. **Defensive query pattern as default.** New dashboard queries use `select` not `include`, even when fetching everything. The pattern cost is +5 lines of typing per query; the failure cost is "all tasks disappeared from the dashboard for hours".

**Where encoded:**

- `app/(dev)/dev/queries/plan.ts` (explicit select + honest catch)
- `app/(dev)/dev/tasks/page.tsx` (error rendering)
- `prisma/schema.prisma` (unchanged — column already there from v0.7.0)
- Neon DB (column added via direct ALTER TABLE)
- This entry (INC-37 + INC-23 cross-reference)

**Confidence:** high — diagnosed via direct Neon query, fix is mechanically verified (column now exists, query no longer fetches removed-or-added columns).

**Tags:** prisma, schema-drift, neon, dashboard, swallow-catch, broad-include, observability, INC-23-recurrence, v0.7.2

### INC-2026-05-29-41 · Review trend chart duplicate-key crash · month-window day-overflow (date-dependent)

**Status:** ✅ FIXED + ENCODED + TESTED — `modules/reviews/trends.ts` month math rewritten to pure integer arithmetic; regression test added; chart key hardened.

**Symptom:** Console error on `/(smb)/reviews`, reported by Viktor on 2026-05-29:

```
Encountered two children with the same key, `2026-03`.
  at ReviewTrendCard.tsx:77  (<g key={b.month}>)
```

Two bars rendered for `2026-03`; February 2026 silently missing from the 12-month trend.

**Root cause:** `buildEmpty12Months` built each bucket via `addMonths(now, -i)` → `setUTCMonth(getUTCMonth() - i)`, which **preserves the source day-of-month**. Run on the 29th–31st, when the 12-month window crosses a short month the day overflows: from 2026-05-**29**, `i=3` targets Feb 2026 day 29 — but 2026 is not a leap year (Feb has 28 days) — so JS rolls it forward to **Mar 1** → `"2026-03"`. `i=2` (real March, day 29) also → `"2026-03"`. February is skipped, March duplicated, React keys collide. Purely **date-dependent**: invisible on days 1–28, fires on 29–31 whenever the trailing window straddles February (or any month shorter than the run day). Not caught by build/typecheck/tests because no test fixed the run date to a month-end.

**Fix applied:**

1. Replaced `addMonths`/`monthFloor` with one overflow-proof helper using integer `year*12 + month` arithmetic (no `Date` day to overflow):

   ```ts
   function monthStart(from: Date, monthsBack: number): Date {
     const total = from.getUTCFullYear() * 12 + from.getUTCMonth() - monthsBack;
     const year = Math.floor(total / 12);
     const month = ((total % 12) + 12) % 12;
     return new Date(Date.UTC(year, month, 1));
   }
   ```

   Both the SQL lower bound (`twelveMonthsAgo`) and the bucket skeleton now use it.

2. Hardened the chart key: `<g key={`${b.month}-${i}`}>` — defensive against any future dup.

3. Added `modules/reviews/__tests__/trends-months.test.ts` — asserts 12 unique, strictly-sequential buckets (with February present) across 7 month-end/leap/year-boundary run dates.

**Prevention:** **Never do month arithmetic with `setMonth`/`setUTCMonth` while preserving the day-of-month.** Use integer `year*12 + month` math and construct from day 1. Grep guard: `grep -rn "setUTCMonth\|setMonth" modules app services lib` should return zero arithmetic uses (the days-in-month idiom `new Date(y, m+1, 0).getDate()` is the only allowed `Date`-based month trick). Any new "trailing N months" / histogram helper MUST have a unit test that fixes the run date to a month-end (29/30/31) crossing February.

**Where encoded:** `modules/reviews/trends.ts` (`monthStart` + comment), `modules/reviews/__tests__/trends-months.test.ts`, `modules/smb-reviews/components/ReviewTrendCard.tsx:77`, this entry.

**Confidence:** very high — traced the exact `i=3`/`i=2` collision from the reported run date; regression test reproduces the old failure and passes on the fix across all risky dates.

**Tags:** date-arithmetic, month-overflow, react-duplicate-key, smb-reviews, date-dependent, regression-test

### INC-2026-06-02-42 · `prisma migrate dev` wants to RESET the drifted prod DB (near data-loss)

**Status:** 🟡 FIXED · rule-encoding incomplete — the execute+resolve recipe below is the canonical prod-migration path; `prisma.md` §6 still shows bare `migrate dev` as the workflow.
**Symptom:** `pnpm prisma migrate dev --name add_landing_pages` against the live Neon DB printed a long "drift" report (Added column/index/FK for Review, SerpResult, BusinessKeyword, QuickWinAssignment, BusinessService…) then: _"We need to reset the 'public' schema… All data will be lost."_ It bailed in non-interactive mode (no reset ran), but a `y` would have dropped the entire 2.1M-business database.
**Root cause:** The live DB has migration-history drift — parts of the schema were historically applied via `prisma db push` (no migration file), so replaying the 14 migration files onto `migrate dev`'s shadow DB doesn't reconstruct the live schema. `migrate dev` reads that as drift and wants to reset to reconcile. `migrate status` stays green because it only compares _recorded migrations vs files_, never _shadow-replay vs live schema_.
**Fix applied:** NEVER `migrate dev` against this DB. For an additive change: (1) edit `schema.prisma`, (2) hand-write `prisma/migrations/<ts>_<slug>/migration.sql` (forward-only, additive), (3) `prisma db execute --file <sql>` with DB env loaded, (4) `prisma migrate resolve --applied <ts>_<slug>`, (5) `prisma generate`. Verified via `migrate status` → "15 migrations found · up to date".
**Prevention:** Mechanical — `package.json db:migrate` = `prisma migrate dev`; do NOT run it against prod/Neon. Use the db-execute + migrate-resolve recipe above for additive migrations. SECONDARY trap that bit here: `cmd && echo` does NOT trip `set -e` (command is in an `&&` list), so a FAILED `db execute --schema` (invalid flag) still let the next `migrate resolve --applied` mark a migration applied whose DDL never ran — run the apply step on its own line and verify its exit code before resolving.
**Where encoded:** this entry + `.claude/rules/prisma.md` §6 (db-push/migrate drift) — adds the migrate-dev-RESET danger + the execute+resolve recipe.
**Confidence:** high
**Tags:** prisma, migration, neon, db-push-drift, data-loss, set-e

### INC-2026-06-02-43 · `rateLimit()` 500s when `isKvAvailable()` is true but `@vercel/kv` env is missing

**Status:** ✅ FIXED + ENCODED — fail-soft try/catch around `limiter.limit()` live in `lib/middleware/rate-limit.ts`.
**Symptom:** every POST to a rate-limited route (`/api/landing-events`) returned HTTP 500 — `Error: @vercel/kv: Missing required environment variables KV_REST_API_URL and KV_REST_API_TOKEN`, thrown from `limiter.limit()` at `lib/middleware/rate-limit.ts:173` — even for malformed bodies that should 400 before any DB.
**Root cause:** `getLimiter()` gates on `isKvAvailable()`, which returned true (looser env signal), so a `Ratelimit` was constructed. But `@vercel/kv`'s `kv` client throws at CALL time when `KV_REST_API_URL`/`TOKEN` are unset. `rateLimit()` only failed soft at the `isKvAvailable()` check, NOT around the actual `limiter.limit()` call → the throw propagated uncaught → 500. This would 500 EVERY rate-limited route (incl. the Stripe webhook → Stripe retries) whenever those two env checks disagree or Upstash is unreachable.
**Fix applied:** wrapped `await limiter.limit(key)` in try/catch in `rate-limit.ts` — on throw, log `rate_limit.limiter_failed` + return null (ALLOW), honoring the module's already-documented fail-soft contract. Also defensively wrapped the `rateLimit` call in the landing-events route (best-effort analytics must never 500).
**Prevention:** A rate limiter is a guard, not a dependency — its failure must degrade to "allow", never 500. `rateLimit()` is now fail-soft at config-check AND runtime-throw; every rate-limited route inherits it.
**Where encoded:** this entry + `lib/middleware/rate-limit.ts` (the try/catch around `limiter.limit`).
**Confidence:** high
**Tags:** rate-limit, vercel-kv, upstash, fail-soft, webhook-resilience

### INC-2026-06-11-44 · "Qualify (4)" enqueued 380+ worker jobs · label/action filter mismatch + no settled-row guard

**Status:** ✅ FIXED + TESTED — v0.15.21 guard pack shipped; 11 unit tests pin the contracts.
**Symptom:** Admin clicked `Qualify (4)` on the Miami cell and 380+ jobs hit Boxly Worker; 892 `admin:qualify-one` CronRuns in 24h (~2 full passes of a 430-business cell), $25.74 spent — roughly double a single pass, with zero new information from the second.
**Root cause:** Three independent gaps that compound: (1) the button label shows PENDING (`businessCount − qualified − disqualified − unreachable`) but `runQualifyCell` enqueued EVERY cell member — no `qualificationStatus` filter; (2) `qualifyBusiness` had no settled-row short-circuit, so re-enqueued rows re-ran the full scrape+AI pipeline; (3) the AI tier-3 idempotency guard checked only the SUCCESS marker (`emailDiscoverySource === "AI_WEB_SEARCH"`) — rows where AI ran and found nothing re-billed ~$0.027 every pass (the `ai_attempted` flag was persisted but never read back). Worse latent risk found by audit: the unconditional persist could NULL a previously discovered email when a re-run's scrape transiently failed (site down/WAF), downgrading QUALIFIED → DISQUALIFIED and destroying paid data.
**Fix applied:** v0.15.21 fix pack — `runQualifyCell` filters `qualificationStatus IN (NOT_QUALIFIED, FAILED)` + chunks enqueues at the worker's 500-job cap; `qualifyBusiness` gained a settled-row guard (`force: true` only for the deliberate per-row admin re-audit) + an email ratchet (`found-before beats found-nothing-now` — never null a prior email, arbitrate status on the KEPT email) + the AI guard now honors the persisted `ai_attempted` flag (and carries it across flag rewrites); `/api/qualify-one` persists best-effort `FAILED` on 5xx so dead rows are distinguishable from never-attempted; `services/ai/client.ts` bills `incrementCost` BEFORE the cost-ceiling throw (the API already responded — the money is spent; throwing first hid real spend from the CronRun ledger).
**Prevention:** Mechanical — 11 unit tests pin the contracts: `app/(admin)/admin/discovery/__tests__/run-qualify-cell.test.ts` (pending-only where-clause, 500/500/200 chunking, tallies summed) and `modules/business-qualification/__tests__/qualify-guards.test.ts` (settled skip = zero work/zero writes, force bypass, ai_attempted suppression + marker persistence, email ratchet keeps QUALIFIED through a transient outage, fresh find still overwrites). Design rule worth keeping: a bulk button's LABEL and its ACTION must derive from the same query; and any pipeline that can overwrite previously-paid-for data needs a ratchet, not idempotency-by-overwrite.
**Where encoded:** this entry + the two test files above + comments at the three fix sites.
**Confidence:** high
**Tags:** qualification, boxly-worker, cost-discipline, idempotency, admin-ux, ai-spend

### INC-2026-06-11-45 · Vercel crons DISABLED project-wide · landing pages rendered "—" + 52 review pulls stuck in-flight

**Status:** 🟡 FIXED · follow-up open — crons re-enabled + data backfilled; the poll-based reviews-reconciliation cron is not yet built.
**Symptom:** Miami launch landing pages (e.g. `/l/yodi-threading-spa-…`) showed "Mapsly score — / 10", "City score —", empty "while you were with clients", empty action plan, website "median/p90 —", and "we'll surface services once reviews analyzed". `/admin/businesses` showed ~52 rows stuck "IN FLIGHT / Pulling…" with "IN DB 0" despite a non-zero Google review count. Raw scans (SERP, Lighthouse, ads) HAD landed — only the _composed_ outputs were missing.
**Root cause:** Vercel Cron Jobs were toggled OFF at the project level (`Settings → Cron Jobs → Disabled`; `vercel crons ls` reported "10 cron jobs found (disabled)"). Three compounding consequences: (1) the review-pull pipeline posts a DataForSEO Standard-queue `task_post` and depends on DfS's pingback to `/api/webhooks/dataforseo/reviews` to call `reviewsTaskGet` + persist — pingbacks did not arrive for the 52 freshly-triggered pulls, and with crons disabled there was no poll-based reconciliation fallback, so `pendingReviewsTaskId` stayed set and reviews=0; (2) the scoring/aggregation chain (`weekly/snapshot-write` → `weekly/cell-aggregate` → `weekly/pillar-score`) never ran after the scans, so `BusinessSnapshot.pillarScore`/`msiRank` and `CellMetric` (website median/p90, city percentile) were absent — the landing reads `snapshot.pillarScore` (mapped to `mapslyScore` in `buildOverviewForBusiness`, `modules/smb-home/queries.ts:147`) and `CellMetric` for benchmarks, both null → "—"; (3) businesses with 0 reviews never got a snapshot at all, so for the 52 stuck rows EVERY score was "—", not just review-derived ones. Bonus latent issue surfaced: `aggregate-cell-maps` Maps `serp/local-pack` calls abort at the 10s default `DATAFORSEO_TIMEOUT_MS` from a high-latency local run (Miami-city centroid returned no pack repeatedly).
**Fix applied:** (1) Re-enabled crons in the Vercel dashboard (toggle → "Enabled", confirmed). (2) One-off recovery `_tmp_review_recover.ts` polled `reviewsTaskGet` for the 52 stuck task UUIDs and ran the EXACT pingback persist logic (upsert + clear cursor + recompute aggregates) → 7,151 reviews recovered, 0 failed, stuckInFlight 52→0. (3) Triggered the compute chain via `CRON_SECRET` against prod: `snapshot-write` ×6 (100/call, 455 active), `cell-aggregate` (42 CellMetrics), `pillar-score` (455 scored) → cohort went 202→256 snapshots, 0→34 Miami CellMetrics. (4) `extract-entities` for the recovered set so review service-mention themes populate. (5) `DATAFORSEO_TIMEOUT_MS` env override added to `services/dataforseo/client.ts` (default unchanged at 10s). Yodi landing post-fix: "#59 of 261", Mapsly 6.8/10, website median 42 / p90 76, ranked action plan — fully rendered.
**Prevention:** (a) `vercel crons ls` must show enabled (not "(disabled)") — add to the launch/handoff checklist; a disabled-cron state is silent and starves every async pipeline. (b) Scans alone don't fill a landing — the **collection → snapshot-write → cell-aggregate → pillar-score** chain must run after any bulk scan; document that manual scans need the compute chain triggered (the weekly crons do this on schedule, but a manual/ad-hoc collection burst does not). (c) Systemic gap worth a future task: review pulls have NO poll-based reconciliation — if a DfS pingback is dropped, the pull is stuck forever; a `cron` that polls `reviewsTaskGet` for businesses with `pendingReviewsTaskId` older than ~1h would self-heal (the recovery script is the manual version).
**Where encoded:** this entry; campaign doc `docs/cold-campaign-miami-2026-06-15.md`; `DATAFORSEO_TIMEOUT_MS` comment in `services/dataforseo/client.ts`.
**Confidence:** high
**Tags:** vercel, cron, reviews, pingback, scoring, cell-metrics, landing, dataforseo, launch-readiness

### INC-2026-06-11-46 · Apify cost tracking ~20× under-counts · ledger $1.10 vs ~$23 actual

**Status:** 🟡 OPEN — ledger corrected; the Apify adapter still under-counts (fix proposed, not shipped). Treat Apify CronRun cost as a lower bound.
**Symptom:** The 53-cell Miami Meta run (`manual:meta-apify-miami-2026-06-11`) logged exactly **$0.02/cell → $1.10 total** on its CronRun; Viktor's Apify dashboard billed **~$23** (~$0.43/cell). Every cell recorded the same $0.02, the tell-tale of a fallback constant, not real usage.
**Root cause:** `services/apify/client.ts runActor` bills `usageTotalUsd || fallbackCostUsd`. Apify finalizes `stats.usageTotalUsd` AFTER the run goes terminal; the adapter re-fetches once after a fixed **1.5s** sleep, but that's too short (worse with concurrency=3 in the launch script), so the re-fetch still read 0 → fell back to `FALLBACK_COST_USD = 0.02` (`services/apify/meta-ad-library.ts:26`) for all 53. Result: Apify spend in the CronRun ledger is ~20× low and untrustworthy — and the cost-discipline $5-ceiling guard can never trip on Apify because it reads the same under-count.
**Fix applied:** Records corrected (campaign doc + ads-rework memory now state ~$23 / ~$0.43-cell as the real figure). The ADAPTER is NOT yet fixed (flagged to Viktor) — proposed: (a) poll `stats.usageTotalUsd` with backoff until non-zero or ~10s elapses instead of a single 1.5s read; (b) if still 0, derive cost from the run's `stats` (compute units × plan rate / `chargedEventCounts`) rather than a flat $0.02; (c) raise `FALLBACK_COST_USD` to a realistic ~$0.40 so a missed read isn't silently 20× low; (d) consider an Apify run-finished webhook that carries final usage, instead of inline polling.
**Prevention:** Treat the CronRun ledger's Apify line as a LOWER BOUND until the adapter is fixed; reconcile against the Apify dashboard for any real budget decision. Mechanical check once fixed: a unit test asserting `runActor` bills the polled `usageTotalUsd` (not the fallback) when the run reports usage, and that the fallback is realistic. Any cron that fans out Apify runs (`ads-meta`) must stay cell-deduped + frequency-capped — at ~$0.43/cell a weekly full re-run of a large metro is real money.
**Where encoded:** this entry; `docs/cold-campaign-miami-2026-06-15.md` Cost section; `[[ads-rework]]` memory.
**Confidence:** high (vendor-billed figure from Viktor).
**Tags:** apify, cost-discipline, cost-tracking, ads-meta, observability

### INC-2026-07-04-47 · Meta actor crashed on startup · Crawlee 3.16 rejected `retireBrowserAfterPageCount` as a top-level option

**Status:** ✅ RESOLVED (fixed + re-pushed build 0.1.17→0.1.18).
**Symptom:** After `apify push` of the hardened meta-ad-library actor (build 0.1.16), EVERY run crashed before doing anything: `ArgumentError: Did not expect property 'retireBrowserAfterPageCount' to exist, got '6' in object 'PlaywrightCrawlerOptions'` at `new PlaywrightCrawler(...)` (main.js:874), Node exit. Production's live actor produced 0 data until fixed. Only caught because the run was live-validated after push.
**Root cause:** `retireBrowserAfterPageCount` is a **BrowserPool** option, not a top-level `PlaywrightCrawler` option. Crawlee 3.16's `ow` schema validates the options object on construction and hard-throws on any unexpected top-level key. The hardening added it at the top level.
**Fix applied:** moved it into `browserPoolOptions: { retireBrowserAfterPageCount: 6 }` (apify-actors/meta-ad-library/src/main.js).
**Prevention:** **ALWAYS live-validate an actor after `apify push` before trusting it** (`apify call <id> -i '{...}'` and read RUN_SUMMARY) — `node --check` catches syntax, NOT Crawlee `ow` runtime validation. Session/BrowserPool-scoped Crawlee options (`retireBrowserAfterPageCount`, `maxOpenPagesPerBrowser`, `retireBrowserAfterPageCount`, etc.) must go under `browserPoolOptions`/`sessionPoolOptions`, never top-level.
**Where encoded:** this entry; `[[leads-workbench-audit]]` memory; the browserPoolOptions comment in main.js.
**Confidence:** high (reproduced live, fix validated live).
**Tags:** apify, actor, crawlee, meta-ad-library, deploy-validation

### INC-2026-07-04-48 · Meta actor primer-GATE zeroed every run during a block wave · `if(!primerOk) return` discarded the resilient path

**Status:** ✅ RESOLVED (fixed + validated build 0.1.18; committed 2167f14).
**Symptom:** After the crash fix, the actor RAN but reached Meta's data on 0/3 validation runs — all `outcome=error`, primer failed to get a `datr` cookie on all 4 IP rotations (`cookies=NONE`). 12/12 primer failures at a historical ~47% data-reach rate is statistically ~impossible by chance → not just a block wave.
**Root cause:** the R1/R2 hardening added a HARD gate in the requestHandler: `run.primerOk = await primeSession(...); if (!run.primerOk) return;`. When Meta denies the isolated prime (block wave), the gate short-circuited the WHOLE run to `error` with ZERO targets attempted — throwing away the pre-hardening path (navigate each target's Ad Library page + intercept its own GraphQL via `onResponse`, which reached data ~47% WITHOUT a standalone primer). A fragile pre-flight was made load-bearing.
**Fix applied:** removed the gate → priming is advisory (a failed prime logs a warning; the run ALWAYS falls through to attempt every target, which re-primes + rotates IP per attempt). Run-level `error` reserved for `statuses.length===0`. Taxonomy preserved (graphqlHits 0=blocked / ≥1=empty_verified / ads>0=ok); `Actor.fail` on error/blocked kept. Validated live: page targets reach data (empty_verified, graphqlHits=1, Success); a blocked search fails loud (blocked, graphqlHits=0, Actor.fail).
**Prevention:** never GATE a whole run on a fragile external pre-flight (a cold Meta prime) when a more resilient fallback exists — make the pre-flight advisory + always attempt the real work, then classify the real work's outcome honestly. When hardening an actor, A/B the data-reach rate against the prior version before shipping (`git show <prev>:…` + a few live runs), not just unit-level correctness.
**Where encoded:** this entry; `[[leads-workbench-audit]]` memory; commit 2167f14 message.
**Confidence:** high (root cause proven via git archaeology; fix validated live).
**Tags:** apify, actor, meta-ad-library, reliability, regression, deploy-validation

### INC-2026-07-05-49 · Meta actor start-nav on a dead IP zeroed the run · non-blocking-primer fix (INC-48) couldn't reach the failing hop

**Status:** ✅ RESOLVED (fixed + pushed build 0.1.19; committed 2120b8c).
**Symptom:** Live run (Access Dental, Kelowna): `PlaywrightCrawler: Request failed and reached maximum retries. page.goto: net::ERR_TIMED_OUT at https://www.facebook.com/` → `requestsTotal:1, requestsFailed:1` → `RUN_SUMMARY outcome=error (no target reached the data query)`. The whole run errored with 0 targets attempted even though pre-known `searchTerms`/`pageIds` targets existed.
**Root cause:** the crawler's SOLE start URL is `facebook.com` (`crawler.run([{url:"…facebook.com/"}])`), and ALL targets are iterated INSIDE `requestHandler` — which only runs AFTER a successful start-nav. On a dead Apify residential exit IP the start `page.goto` times out; Crawlee retries (`maxRequestRetries:2`) but there was **no `errorHandler`**, so all retries re-hit the SAME dead IP (the manual `rotateSession`/`session.retire()` only lives inside the handler, which never ran). After retries exhaust, the finalizer sees `statuses.length===0` → `outcome=error`. Crucially, INC-48's non-blocking-primer fix is UNREACHABLE here — it lives inside the requestHandler; a start-nav failure is a different, earlier hop.
**Fix applied:** added `errorHandler({session,request},err)` that calls `rotateSession(session,…)` on EVERY failed attempt (retires the session → next retry navigates on a FRESH IP); raised `maxRequestRetries` 2→5 (more rotations); dropped `navigationTimeoutSecs` 90→40 (abandon a dead start-IP fast — scrapeTarget's own gotos pass explicit `{timeout:90000/30000}`, so only the start nav shortens). Genuine block waves still surface honestly as `blocked` once targets are attempted.
**Prevention:** when a crawler funnels 100% of work through ONE gating start navigation, that hop needs its OWN IP-rotation-on-failure (`errorHandler` retiring the session) — an in-handler rotation fix does nothing for a nav that never enters the handler. Mechanical check: a PlaywrightCrawler on Apify residential proxies with a single start URL MUST wire an `errorHandler` that `session.retire()`s, else built-in retries hammer a dead exit. When you fix a "dead IP" class bug inside the handler, verify the START nav is covered too.
**Where encoded:** this entry; the errorHandler + maxRequestRetries/navigationTimeoutSecs comments in `apify-actors/meta-ad-library/src/main.js`; `[[enrichment-flow-map]]` memory.
**Confidence:** high (root cause traced in source; fix built + deployed 0.1.19).
**Tags:** apify, actor, crawlee, meta-ad-library, reliability, ip-rotation, start-nav

### INC-2026-07-05-50 · Drawer Ads card showed Meta activity for a business whose Meta scan ERRORED · B1 combined-total mislabel + Google-OK masked Meta-FAILED

**Status:** ✅ RESOLVED (fixed + shipped 2120b8c, v0.19.1).
**Symptom:** Access Dental (Meta scan errored, 0 Meta ads, 1 Google ad) — the drawer Ads card read header "Meta: — · Google: 1" while the "Meta ads" bar showed "1 · typical 0 · 50th pct". The "1" was actually the Google ad; the header "—" implied a verified zero when the Meta scan had FAILED.
**Root cause:** three linked defects, all from B1 (commit b8789b7). (1) The vs-cell bar row was labelled "Meta ads" but its `metric.value` was changed to `metaAds.length + googleAds.length` (all-platform total) — a lone Google ad rendered as "Meta ads: 1" (`lead-detail.ts` ads block). (2) The shared `ads` family folds META+GOOGLE into one run-state: `adsFailed && !adsRan` → a Google OK (adsRan=true) MASKED the Meta FAILED → family read "enriched" with no failure surfaced. (3) A degenerate cohort band (all-zero ad market → p90<=p10) makes `percentileFromBand` return 50, fabricating "typical 0 · 50th pct" for a lone advertiser.
**Fix applied:** (1) relabelled the row "Active ads" (it IS the all-platform total) and suppress its bar (`metric:undefined`) when `metaScanFailed`. (2) track META/GOOGLE run-state SEPARATELY (`metaRan/metaFailed/googleRan/googleFailed`); derive `metaScanFailed = metaFailed && !metaRan`; header shows "Meta: scan failed" instead of "—" when set (family-level `adsRan/adsFailed` kept as the OR, so the coverage dot is unchanged). (3) suppress the vs-cell bar in `LeadDrawer.tsx` when the band is degenerate (`rawBand.p90 > rawBand.p10 ? rawBand : undefined`) — falls through to honest text.
**Prevention:** a value's row LABEL must match the SCOPE of the value it plots — if a "Meta ads" bar starts carrying a Meta+Google total, rename it or it lies. When two data sources share one coverage family, a per-family "failed" flag must NOT let one source's success mask the other's failure — track per-source run-state and surface the failed one in the drawer even when the family dot is "enriched". Never plot a marker on a degenerate distribution (p90<=p10) — it manufactures a false "typical/percentile" reading; guard at the render layer.
**Where encoded:** this entry; the "B1 honesty fix" comments in `modules/agency-portal/discover/lead-detail.ts` + `components/LeadDrawer.tsx`; `[[enrichment-flow-map]]` memory.
**Confidence:** high (root cause traced end-to-end by a dedicated agent; fix shipped + gate green).
**Tags:** agency, drawer, ads, honesty, regression, b1, meta, google, run-state

### INC-2026-07-06-51 · dom-fetcher git source has silently diverged from the live Apify actor (force-push would regress Lighthouse)

**Symptom:** while syncing the dom-fetcher actor source to Apify (`apify push` after committing a Cloudflare-Turnstile-detection change), the CLI refused: "Actor 'mapsly-contact-scraper' ... was modified there since modified locally. Skipping push. Use --force." An `apify pull` + diff of the LIVE actor vs `git HEAD` revealed the two have diverged in BOTH directions, not a timestamp artifact.
**Root cause:** the git-committed dom-fetcher (`apify-actors/dom-fetcher/src/main.js`, at HEAD and HEAD~1) is the **R3 fail-loud rewrite** (per-URL outcome taxonomy + RUN_SUMMARY + `Actor.fail` on fully-walled runs) — but it **dropped the in-browser Lighthouse mode** (`input.lighthouse`, playwright-lighthouse, remote-debug port, mobile CWV scoring). The **LIVE platform actor is the older "v1.1 + optional Lighthouse"** build that still HAS Lighthouse and has **no** R3 taxonomy. So the R3 rewrite was committed to git but NEVER deployed; the live actor kept the pre-R3 LH feature. Neither side is a superset — git has R3, live has LH. On-demand Lighthouse for walled sites (DfS can't audit a 403 challenge page) is a real, documented, in-use capability ([[scraper-cost-test]]).
**Fix applied:** did NOT `--force`. Aborted the dom-fetcher deploy (the Turnstile change stays source-only until reconciled). Cleaned up the stray dir the old CLI wrote INSIDE the repo (`--dir <abs>` was treated as relative to cwd → `mapsly/private/tmp/...`; `rm -rf private/`). The Meta actor + app-side ship (v0.19.4) are unaffected and live.
**Prevention:** (1) NEVER `apify push --force` on an actor without first `apify pull`-ing the live version and diffing — the git source can be behind/ahead of live in features. If the live actor has a capability the git source lacks, forcing REGRESSES production. (2) Reconcile dom-fetcher as its own task: port R3 taxonomy + the new Turnstile `cf-mitigated`/BODY_CHALLENGE detection ONTO the LH-carrying live version, `apify push`, test both a walled site (LH) and a Turnstile site before trusting it. (3) The deeper landmine: git actor source ≠ deployed actor is invisible to `pnpm deploy-check` (it never touches Apify). Treat every `apify-actors/*/src/main.js` git change as source-of-record ONLY; deployment is a separate, explicitly-verified `apify push` per actor. `apify pull`+diff is the only truth for "what is live."
**Where encoded:** this entry; [[meta-actor-robustness]] memory (dom-fetcher divergence note); the abort is logged in build-log.
**Confidence:** high (live-vs-git diff captured end-to-end; both feature sets confirmed present on exactly one side).
**Tags:** apify, actor, dom-fetcher, divergence, deploy, lighthouse, force-push, landmine, git-vs-live

### INC-2026-07-06-52 · git apply is atomic — per-file "Applied ... cleanly" lines do NOT mean those files landed

**Symptom:** a 3-file patch from a worktree agent printed "Applied patch to LeadDrawer.tsx cleanly" + "Applied patch to lead-detail.ts cleanly" but errored on the third file (CSS "does not match index"). The two TSX files were silently NOT applied — git apply is all-or-nothing. The tree ended up with the CSS half of a drawer rework and none of its markup (~150 lines of dead CSS + deleted live rules). Caught only by the ux-reviewer-agency agent diffing tree-vs-HEAD; tsc/tests stayed green because dead CSS type-checks fine.
**Root cause:** `git apply` (with or without --3way) is atomic across the whole patch; its per-file "cleanly" messages are dry-check progress, not commit confirmations. A partial re-apply with `--exclude` then landed ONLY the remaining file, making the tree look complete at a glance.
**Fix applied:** re-applied the missing hunks with `--include=<file>` for exactly the two dropped files, then re-ran prettier/tsc/full suite.
**Prevention:** after ANY `git apply`, mechanically verify per-file landing: `git status --short` must list EVERY file the patch touches (compare against `grep '^+++' patch | sort`). Never trust the "Applied patch to X cleanly" lines. When one file of a multi-file patch conflicts, fix the conflict and re-apply the WHOLE patch, or apply per-file with explicit `--include` for each — never assume the clean ones stuck.
**Where encoded:** this entry.
**Confidence:** high (reproduced end-to-end in-session).
**Tags:** git, apply, patch, worktree, atomic, subagent, merge

### INC-2026-07-07-53 · a green /ship push ≠ Vercel deployed — a GitLab→Vercel webhook can silently miss a commit

**Symptom:** `/ship` v0.19.11 reported success — `git push gitlab main` printed `210ca01..c854fd5 main -> main` to both gitlab.com and github.com, and `git ls-remote gitlab main` confirmed `c854fd5` on the remote. But the app didn't update in production. The Vercel API (`GET /v6/deployments?projectId=…`) showed the newest PRODUCTION deployment was still `210ca01` (the previous ship); `c854fd5` was **absent from the deployment list entirely** — Vercel never built it. Every prior ship (210ca01, 94fa2d0, …) showed `state=READY`, so the integration is healthy; this was a one-off missed webhook.
**Root cause:** Vercel is Git-connected to **GitLab** (`project.link.type=gitlab`, `productionBranch=main`). A production deploy is triggered by GitLab firing a push webhook to Vercel — NOT by the git push itself. That webhook delivery is best-effort; it silently failed to fire (or Vercel didn't receive it) for this one commit. Nothing in `/ship` verifies the deploy actually started — the skill ends at "push succeeded."
**Fix applied:** diagnosed with the working `VERCEL_TOKEN` in `.env.local` (v6/deployments API + v9/projects link). Did NOT force a deploy: auto-mode blocked `vercel deploy --prod` as an unsanctioned direct-deploy path (the "Ship it" consent covered git-push only), which is correct. Surfaced options to Viktor; he chose to redeploy from the Vercel dashboard. Clean re-trigger with no new commit = **GitLab → project → Settings → Webhooks → the Vercel hook → Redeliver** the last push event (a plain Vercel "Redeploy" reuses the PREVIOUS sha, so it must target the latest `main` commit / redeliver the webhook).
**Prevention:** (1) `/ship` is not done at "push succeeded" — after the push, VERIFY Vercel started a build for the pushed SHA: `GET https://api.vercel.com/v6/deployments?projectId=prj_A9rIJvK7E8yhBBN6xJ9FZgTAE75R&teamId=team_lHLUUp1khLrYJlBHeVZbSCzH&limit=3` with `Authorization: Bearer $VERCEL_TOKEN`, and confirm the top entry's `meta.gitlabCommitSha`/`githubCommitSha` matches the just-pushed HEAD (state will be BUILDING→READY). If the SHA is absent after ~1 min, the webhook missed — re-deliver it from GitLab (never bypass /ship with a direct `vercel --prod`). (2) The token + API calls used here are read-only diagnostics and are the fast way to answer "did it actually deploy?" without the Vercel MCP (which needs interactive auth). (3) projectId/teamId are stable: `prj_A9rIJvK7E8yhBBN6xJ9FZgTAE75R` / `team_lHLUUp1khLrYJlBHeVZbSCzH`.
**Where encoded:** this entry; [[gitlab-primary]] memory (Vercel-from-GitLab + verify-deploy note).
**Confidence:** high (deployment list captured pre/post; SHA absence confirmed end-to-end).
**Tags:** vercel, gitlab, webhook, deploy, ship, missed-trigger, verify-after-push, landmine

---

### INC-2026-07-07-54 · touchpoints cold-email copy fabricated claims by SPLICING independently-sourced fields — the nano fact-check can't catch a mis-grounded skeleton

**Symptom:** the "touch v2 · stand out with rich data" batch shipped (in WIP) three disprovable email claims, each built by joining fields with NO shared provenance: (1) `competitor_ads` → "{topRivalName} and N others are running Google ads for '{trackedKeyword}'" — `topRivalName` is a Google-Maps _people-also-search_ adjacency seed (zero ad data), the count is a **Meta** AdMarketRun advertiser count (wrong platform), and `trackedKeyword` is a synthesized `{category} {city}` string (no ad matched it); (2) `serp_not_in_pack` → "you're #{organicRank} for '{trackedKeyword}'" — a real `organicRank` from the newest SerpResult (keyword-unfiltered read) bound to the _derived_ keyword the rank was never measured for; (3) "Search '{trackedKeyword}' and {packLeaderName} shows up first" — `pack1Name` is written per-keyword by TWO scanners (cell-intel MAPS for `{category} {city}` AND `aggregate-cell-maps` across the whole template pool), so the named leader is routinely for a different query. Each is falsified the moment the business owner searches.
**Root cause:** the deterministic first-touch skeleton composed a compound claim from fields that resolve _independently_ (different DB rows, different sources, no join key threaded through). `gatherTouchSignals` reads `serpResult.findFirst({ where: { businessId } })` with no `keywordId` filter, then _derives_ `trackedKeyword = "{category} {city}"` and throws away the row's actual `keywordId` instead of joining `Keyword.keyword` — so the rendered keyword and the rendered rank/leader come from different rows. The `nano-fill.ts` fact-check only validates _skeleton → LLM-rewrite_ fidelity (number-grounded, name-preserving); it treats the skeleton as ground truth, so a fabrication _in the skeleton_ passes untouched.
**Fix applied:** removed every splice — `competitorAdsLine` is now count-only ("N businesses in {city} are running ads while you're not", grounded in the real Meta advertiser count); `serp_not_in_pack` theme deleted; the `packLeaderName × trackedKeyword` step-2 lines deleted; the "{rival} is the name Google keeps putting in front of you" precedence line deleted. Kept only fully-grounded lines (own review quote, own LCP number, own booking gap, Meta ad count, `topRivalName` **adjacency** = "turns up next to you", own lighthouse score, own tenure). `organicRank`/`localPackRank`/`trackedKeyword`/`packLeaderName` are gathered-but-declaration-only now, with docs forbidding re-render until real keyword reconciliation lands. Tests that had LOCKED IN the fabricated strings were rewritten to assert the honest output and to `.not.toContain` the old strings.
**Prevention (mechanical):** a per-business copy line may name an external entity (rival, pack leader) or quote a rank/keyword ONLY when every part comes from ONE reconciled data row — the entity, the rank, and the keyword must share a join key that is actually threaded to the render site. Checklist for any new `modules/outreach/first-touch.ts` line: "Does this line combine ≥2 signal fields? If yes, do they come from the same source row, or could they describe different keywords/entities/platforms? If they can diverge, DROP the line or reconcile at the gatherer." Grep guard: any `first-touch.ts` template literal interpolating a `*RivalName|*LeaderName|*Keyword|*Rank` field is a review trigger — verify provenance, don't trust a derived string. The nano fact-check is NOT a safety net for skeleton fabrication; only real per-business data may enter the skeleton.
**Where encoded:** this entry; `modules/outreach/first-touch.ts` TouchSignals docs (INC-54 markers on the four fields + competitorAdsLine header); rewritten `first-touch.test.ts` honesty assertions (`.not.toContain("Google ads")` etc.); [[touchpoints-audit]] memory.
**Confidence:** high (two independent adversarial verification rounds traced provenance end-to-end across cell-intel/serp.ts, aggregate-cell-maps.ts, discover-local-intent.ts writers).
**Tags:** outreach, touchpoints, honesty, cold-email, fabrication, provenance, splice, nano-fact-check, serp, meta-ads, review-caught

### INC-2026-07-10-55 · a second internal route (run-playbooks) accepted ONLY CRON_SECRET while the Boxly worker calls it with BOXLY_WORKER_AUTH_TOKEN → the close-playbooks sweep 401'd silently for 8 days

**Symptom:** worker log `[CallbackWebhookProcessor] [callback-webhook · mapsly:enrich-close-playbooks] client error 401 · {"error":"unauthorized"}`. `CronRun` job `enrich:playbooks` = 0 rows in 10 days; 55 findings stuck missing-enrichment though their data existed.
**Root cause:** `app/api/internal/run-playbooks/route.ts` gated on `verifyCronAuth(req).ok` only. The worker's CallbackWebhookProcessor authenticates with the worker token, not CRON_SECRET, so every callback 401'd. The sibling `/api/internal/enrich-job` already accepts EITHER (worker OR cron); this route was never updated when the worker began calling it.
**Fix applied:** `const workerOk = verifyBoxlyWorkerAuth(request.headers.get("authorization")); const cronOk = verifyCronAuth(request).ok; if (!workerOk && !cronOk) 401`. Added a route test asserting worker-token → 200 (the regression) + cron → 200 + neither → 401. POST-DEPLOY: trigger the sweep once to clear the 55 stuck findings.
**Prevention (mechanical):** EVERY `app/api/internal/*` route the Boxly worker can call MUST accept dual-auth (worker OR cron) — grep guard: an internal route whose only auth is `verifyCronAuth` and whose path is referenced by any worker `enqueueCallbackWebhooks`/CallbackWebhookProcessor target is a defect. When adding a worker callback target, copy enrich-job's `workerOk || cronOk` gate.
**Where encoded:** this entry; run-playbooks/route.ts header + dual-auth; run-playbooks/**tests**/route.test.ts; [[run-forensics-fixes-shipped]].
**Confidence:** high (reproduced the token-kind mismatch; enrich-job is the working reference).
**Tags:** worker, boxly, auth, internal-route, cron-secret, playbooks, silent-401, close-sweep

### INC-2026-07-10-56 · every Meta AdMarketRun booked the $0.02 FALLBACK constant — real Apify cost (~$0.72–1.22/run) was ~40× higher, so the cost-ceiling went blind AND repricing from our own data would have been wrong

**Symptom:** DB: all 10 META AdMarketRuns (OK + FAILED) recorded costUsd exactly 0.02. Apify console for the same 4 runs: $0.724+$0.765+$1.215+$0.772 = $3.48. Books under-counted meta ~40×.
**Root cause:** the Meta actor times out at 280s (60 page-targets ÷ 280s is structurally over-budget). Apify finalizes `stats.usageTotalUsd` for a TIMED-OUT run a beat AFTER terminal — often past our ~300s function budget — so `runActor`'s refetch loop read 0 and `billed = usageTotalUsd || fallbackCostUsd` fell to the $0.02 constant. The cost driver is residential-proxy traffic + images (NOT compute), so a compute-based estimate would also under-count.
**Fix applied:** in `services/apify/client.ts`, when `usageTotalUsd<=0` after the refetch loop, estimate `gbHours × APIFY_EST_USD_PER_GB_HOUR(2.8)` from the run's real wall time × provisioned memory (elapsed-scaled → a fast run ~$0, a full-timeout ~$0.87). Bumped `APIFY_META_RUN_USD` COGS estimate 0.12→0.85. Repriced meta CREDIT_PRICES 12→25/cell (Viktor: 1 charge per market). The Phase-5 reconcile cron (needs an apifyRunId column · migration) makes the lagging ones exact.
**Prevention (mechanical):** a vendor adapter's fallback cost constant must be plausible for the WORST realistic run, never a placeholder penny — a flat fallback <10% of a real run silently blinds the cost ceiling. When an actor can TIME OUT, the cost path must handle "usage finalizes after we return" (elapsed×memory estimate now, reconcile cron later): the sync refetch can't win that race inside the function budget. Grep guard: any `fallbackCostUsd` < (memory_GB × timeout_hours × ~$2.8) is suspect.
**Where encoded:** this entry; client.ts APIFY_EST_USD_PER_GB_HOUR + comment; pricing.ts APIFY_META_RUN_USD/CREDIT_PRICES comments; [[run-forensics-fixes-shipped]], [[meta-actor-robustness]].
**Confidence:** high (Apify console screenshot vs DB proven; fix is elapsed-scaled so it self-limits).
**Tags:** apify, meta-ads, cost-discipline, fallback-constant, timeout, usage-finalization, pricing, blind-ceiling

### INC-2026-07-10-57 · a Meta run that TIMED OUT after already returning 43 advertisers was discarded FAILED (paid-for data thrown away, billed nothing); AND closeRunIfDone closed the run while the async cell was still collecting

**Symptom:** the dental run's Meta cells delivered 43/15 advertisers into their (timed-out) Apify datasets; the app showed 0 and billed 0. Separately: the rerun closed at 00:33:23 while META landed at 00:35:11 (11 advertisers, 12cr never billed, invisible until reload).
**Root cause (two joined defects):** (1) `modules/cell-intel/meta-ads.ts` hard-returned FAILED on outcome ∈ {blocked,timeout,error} BEFORE the aggregation/persist step, discarding `out.rows`/`out.advertisers` that `runActor` had already salvaged from the timed-out dataset. (2) `closeRunIfDone` counted only `EnrichmentJob` rows (QUEUED/RUNNING); cell families (meta/serp) create NO EnrichmentJob rows — when the worker collects them via an async enrich-cell callback, the run had 0 open jobs and closed while the cell was in flight.
**Fix applied:** (1) SALVAGE — a blocked/timeout/error run that STILL returned data (`rows.length>0 || advertisers.length>0`) now falls through to persist and records PARTIAL (Viktor: "timeout-with-results = success"); only a 0-data unverified run stays FAILED. The soft-block-suspicion heuristic (0 advertisers ∧ 0 ads) still flips genuine empties to FAILED. (2) `pendingCellCount` — closeRunIfDone holds the run open while any requested cell family lacks a terminal AdMarketRun since startedAt AND isn't served-fresh; a 15-min ceiling prevents a dead worker from stalling forever (reverse-stall).
**Prevention (mechanical):** (a) a scraping actor's timeout/abort is NOT "no data" — read the dataset and decide by yield, never discard on status alone (runActor salvages; the CONSUMER must not re-discard). (b) a run-completion predicate must count EVERY work unit the run fanned out, including ones that DON'T create the primary job row (cell families here) — grep guard: any "is this run done?" check that reads only `enrichmentJob` while the run's `enrichmentsJson` can contain CELL_FAMILIES is incomplete.
**Where encoded:** this entry; meta-ads.ts salvage block; dispatch.ts pendingCellCount + closeRunIfDone gate + dispatch.test.ts (salvage/pending/ceiling cases); [[run-forensics-fixes-shipped]], [[run-forensics-dental]].
**Confidence:** high (traced on live DB; salvage + pendingCells unit-tested).
**Tags:** meta-ads, apify, salvage, timeout, run-close, cell-family, pendingCells, reverse-stall, billing, invisible-result

### INC-2026-07-10-58 · the "fixed" Meta pipeline still bled on first contact with prod: wrong Apify usage field ALL ALONG, a runaway reconcile-continuation on blocked cells, and a $0 backfill zeroing real spend

**Symptom:** 20 min after v0.19.18 deployed, Viktor's rerun (run cmrefu3km, 45 leads) showed: toolbar "Enrich 45 · ~52 cr" but held 30 / charged 3; run "finished" while the Meta actor kept launching new runs (2 fails + a fresh run in the Apify console); progress plateaued at 42/45.
**Root cause (three compounding):** (1) **Wrong JSON path since the adapter was written** — Apify's run-detail endpoint carries usage at `data.usageTotalUsd` (TOP-LEVEL, live-updating even mid-run); `data.stats.usageTotalUsd` NEVER existed there. Every poll read undefined → billing always fell to the fallback. INC-48's "usage finalizes a beat later" and INC-56's refetch loop were treating a symptom of a mis-read field. Proven by fetching the same run via list (usage $0.77) vs detail stats (absent). (2) **Runaway continuation** — meta-reconcile's chunk-continuation scanned `detailJson.pendingTargets > 0` WITHOUT checking row status, and the collector writes pendingTargets on hard-FAILED 0-progress rows too; a Meta-blocked cell (hvac·Kelowna — RUN_SUMMARY-class block, chunking can't fix it) therefore got re-attempted every 10-min tick at ~$0.9/attempt for up to the 48h lookback (~$250/cell worst case). Caught after 3 attempts (~$1.70): aborted the in-flight run via API + neutralized pendingTargets by hand (Viktor-approved 3-row prod UPDATE). (3) **$0 backfill zeroed real spend** — with the field unreadable, fetchFinalizedUsage fell to my "terminal → accept $0" branch 3.5 min after terminal and OVERWROTE a real $0.77 row with costUsd 0.
**Fix applied:** client.ts + meta-reconcile.ts read `data.usageTotalUsd ?? data.stats.usageTotalUsd` (both poll + refetch + backfill); continuation now gated on newest-row **status=PARTIAL** (real progress) + a per-cell attempt cap (4 rows/48h → parked with reconcileNote "attempt-cap-reached"); $0 accepted only when terminal ≥15 min (finishedAt from the same response). Bonus un-poisoning: `google_ads_skipped` removed from NON_RETRYABLE_FAILURE_REASONS — 49 legacy rows carry it for TRANSIENT pre-fix throws, which had silently marked those pairs "permanently unavailable" for 30 days (the real reason the rerun quoted/held only 30 of the shown ~52).
**Prevention (mechanical):** (a) NEVER trust a vendor response field from docs/memory — verify the actual payload with one curl BEFORE building billing on it, and when a fallback constant fires >90% of the time treat that as "the primary path is broken", not "the fallback works" (the $0.02 books were the tell for a YEAR of runs). (b) Any auto-retry loop keyed off persisted state MUST couple three guards at birth: a progress predicate (only re-attempt when the last attempt moved something), a per-subject attempt cap, and a kill switch (here: zeroing the marker) — a schedule × unguarded-marker = unbounded spend. (c) A "trust $0" branch on financial data needs a settling grace window keyed to the vendor's own terminal timestamp. (d) After ANY money-path deploy, watch the FIRST real run end-to-end (DB rows + vendor console) before walking away — this class only shows up on contact with prod.
**Where encoded:** this entry; services/apify/client.ts (INC-58 comments at both read sites); modules/cell-intel/meta-reconcile.ts (gates + grace); dispatch.ts NON_RETRYABLE comment; regression tests (runaway-continuation, attempt-cap park, $0-grace, google_ads_skipped retryable); [[run-forensics-fixes-shipped]].
**Amendment (same night, 13-agent verified deep-dive):** (e) **The "blocked" hvac cell was OUR proxy, not Meta's wall** — the actor's residential exits came from RANDOM countries (Italy/US/Ecuador on the 3 failures vs a lucky Canadian IP on the one success) because the platform injects the INPUT_SCHEMA's default proxyConfiguration (no countryCode) into every input, making the actor's own countryCode fallback dead code. Fix: the ADAPTER now pins `proxyConfiguration.countryCode = countries[0]` (works with the deployed actor). A geo-mismatched exit = Meta session soft-block (graphqlHits=0 across all targets) — and the 280s timeouts were a symptom of blocked-target retry grinding, not a speed ceiling. (f) **Zombie zero-job runs** — a user run whose every (business,family) pair is dead-pair-skipped fans out ZERO jobs; the crash-phantom guard then refuses to close it and reconcileStuck re-fans it every 15 min FOREVER ("Enriching · 0 of 1" immortal). Fix: fan-out stamps `fanOutEmptyJobs` → closeRunIfDone closes it PARTIAL·0-done; and the permanent cap now counts DISTINCT RUNS (not attempt rows), so one afternoon of in-run retries can't hang a 30-day sentence. (g) google_ads poisoning measured at real scale: 40/45 (89%) of the rerun cohort dead-paired = 38 of the toolbar's 52 phantom credits.
**Confidence:** high (every claim reproduced against live Apify API + prod DB rows; 13-agent adversarial verification, all CONFIRMED).
**Tags:** apify, meta-ads, billing, runaway-loop, reconcile, wrong-field, cost-discipline, prod-contact, INC-48-correction, INC-56-correction, proxy-geo, zombie-run

### INC-2026-07-10-59 · a domain that DOESN'T EXIST IN DNS spent three runs on the "transient — retry" ladder because every fetch failure collapsed to one unnamed bucket

**Symptom:** livingwaterplumbing.ca (NXDOMAIN — no A record at all) showed "failed · retry" in the workbench across 3 runs; Viktor's 1-lead retry on it became the INC-58 zombie run. aspen-heating.ca (persistent HTTP 500) and vikingrefrigeration.com (403-for-everyone) rode the same undifferentiated treadmill. A parked "buy this domain" lander would have been WORSE: fetch "succeeds" → we'd extract the BROKER's links as the business's contacts.
**Root cause:** evidence discarded at both fetch layers. `fetchSiteHtml`'s `catch { return FAILED }` threw away the Node error code (`ENOTFOUND` was in hand); `fetchViaDomFetcher` dropped the actor's `net::ERR_*` string; `classifyDomFetch` folds every hard failure into one retryable `error` class; the scan reported a bare `status:"FAILED"` and dispatch mapped ALL of it to `contacts_fetch_failed` (retryable). "Permanent" could only ever be inferred statistically (the 3-distinct-runs cap), never named.
**Fix applied (cheap set):** (1) `FetchSiteResult.errorCode` — both fetch paths preserve the cause (undici wraps the real code on `err.cause.code`; walk the cause chain). (2) `modules/contacts/site-verdict.ts` (pure, unit-tested): `classifySiteFailure` → `site_gone_dns` (ENOTFOUND/EAI_NONAME/ERR_NAME_NOT_RESOLVED/NXDOMAIN — EAI_AGAIN deliberately EXCLUDED, it's OUR resolver hiccup) and `site_gone_conn` (ECONNREFUSED/EHOSTUNREACH/ERR_CONNECTION_REFUSED); `looksParkedDomain` → registrar-provider fingerprints (sedoparking/parkingcrew/bodis/hugedomains/afternic/dan…) decisive anywhere, for-sale phrases only in title/leading text of small pages (big pages quoting the phrase don't trip). (3) Scan returns `failureReason`; parked pages short-circuit BEFORE extraction (no broker junk); an authoritative direct-fetch verdict SKIPS the paid dom-fetch fallback. (4) Dispatch maps to `contacts_site_gone_dns|_conn|_domain_parked` — added to NON_RETRYABLE_FAILURE_REASONS → permanent on the FIRST strike, dead-pair machinery excludes them from quotes/fan-out immediately, the 30-day recovery window re-probes monthly. 5xx/403 deliberately stay UNNAMED (can't cheaply distinguish a bad deploy/WAF from dead) — the 3-distinct-runs cap covers them.
**Prevention (mechanical):** a fetch/network failure handler may NEVER discard the error code — `catch { return FAILED }` on a vendor/site call is a review-blocker; return the cause and let a PURE classifier decide transient-vs-permanent. Any "retry" affordance shown to a user must be backed by a named reason that a retry could plausibly fix. Grep guard: `catch\s*\{\s*(return|\/\*)` in fetch adapters.
**Deferred (named follow-ups, not silently dropped):** `Business.websiteStatus` column + workbench "Website gone / Domain parked" chips (Viktor's UI lane); identity-mismatch layer (domain resold to a DIFFERENT real business — needs GBP identity anchors); registry signals `website_dead` / `domain_parked` (a premium agency prospecting signal — a business with reviews but a dead domain is the hottest "needs a website" lead).
**Where encoded:** this entry; modules/contacts/site-verdict.ts (+9 tests); fetch-site.ts errorCode; scan.ts verdict wiring (+4 tests); dispatch.ts reason mapping + NON_RETRYABLE additions (+2 tests); [[run-forensics-fixes-shipped]].
**Confidence:** high (all three real cases probed live: NXDOMAIN / 500 / 403; fingerprints unit-tested both ways).
**Tags:** contacts, dom-fetch, dead-website, parked-domain, nxdomain, permanent-failure, evidence-preservation, retry-treadmill
