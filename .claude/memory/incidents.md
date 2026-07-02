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
