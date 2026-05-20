# Mapsly · PLAN.md

The build roadmap. Source of truth for **what to build next**. Read by `autonomous-build-loop` skill and by Viktor.

Status values: `pending` · `in_progress` · `blocked` · `completed`
Effort values: `S` (≤ 1h) · `M` (1–3h) · `L` (3–8h) · `XL` (8h+, needs human)
Tags: `human-required` means autonomous mode must skip; `signals` involves new signal logic; `db-migration` involves schema change.

---

## Phase 0 · Foundations (scaffold day — done)

| ID  | Task                                                                                                                       | Effort | Status | Deps |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | ---- | --- |
| 0.1 | Initialize Next.js 16 + Prisma 7 + Tailwind 4 + NextAuth scaffolding                                                       | S      | done   | done | —   |
| 0.2 | Prisma schema for full data model (Business, Snapshot, Review, Lighthouse, AdLib, SERP, Keyword, List, Lead, Agency, etc.) | S      | done   | done | 0.1 |
| 0.3 | docs/data-cadence.md — what runs daily/weekly/monthly + cost ceiling per tier                                              | S      | done   | done | —   |
| 0.4 | .env.example with all integrations                                                                                         | S      | done   | —    |
| 0.5 | .mcp.example.json with all MCPs (rename to .mcp.json post-clone)                                                           | S      | done   | —    |
| 0.6 | CLAUDE.md + .claude/rules + .claude/agents + .claude/skills (in \_claude-setup/ — move post-clone)                         | L      | done   | —    |
| 0.7 | vercel.json with cron schedule for all 17 jobs                                                                             | S      | done   | —    |

---

## Phase 1 · Get the app booting (week 1)

Goal: `pnpm dev` runs, magic-link signin works, an empty SMB and Agency dashboard render.

| ID      | Task                                                                                                             | Effort | Status  | Deps          | Tags             |
| ------- | ---------------------------------------------------------------------------------------------------------------- | ------ | ------- | ------------- | ---------------- |
| 1.1     | `pnpm install` runs clean; `pnpm typecheck` passes on empty modules                                              | S      | done    | 0.1           |                  |
| 1.2     | Set up Neon DB + run `prisma db push` to create initial schema                                                   | S      | done    | 0.2           | db-migration     |
| 1.3     | Wire NextAuth v5 (Resend magic link) + sign-in pages (`/signin`, `/signin/check-email`)                          | S      | pending | 1.2           |                  |
| 1.4     | Resend email template for magic links + onboarding welcome                                                       | S      | pending | 1.3           |                  |
| 1.5     | Empty SMB dashboard scaffold at `/(smb)/dashboard` — pulls latest BusinessSnapshot, renders 6 KPI tiles          | S      | pending | 1.3, 0.2      |                  |
| 1.6     | Empty Agency lists scaffold at `/(agency)/lists` — pulls Agency.lists, renders cards                             | S      | pending | 1.3, 0.2      |                  |
| 1.7     | Marketing landing migrated from `_design/landing/index.html` to `/(marketing)/page.tsx`                          | S      | pending | 1.1           |                  |
| 1.8     | For-agencies marketing migrated from `_design/landing/for-agencies.html` to `/(marketing)/for-agencies/page.tsx` | S      | pending | 1.1           |                  |
| 1.9     | Deploy to Vercel preview · validate end-to-end on real domain                                                    | S      | done    | 1.5, 1.6, 1.7 |                  |
| 1.10.1  | Subdomain routing · middleware.ts dev rewrite + Vercel domain config                                             | S      | done    | 1.1           | dashboard        |
| 1.10.2  | `app/(dev)/dev/page.tsx` · layout + hero tiles + section grid with mock data                                     | S      | done    | 1.10.1        | dashboard        |
| 1.10.3  | Real data · GitHub commits + open PRs feed (queries/github.ts)                                                   | S      | done    | 1.10.2        | dashboard        |
| 1.10.4  | Real data · PLAN.md parser (status pills + scores per phase)                                                     | M      | done    | 1.10.3        | dashboard        |
| 1.10.5  | Real data · session JSON reader · 7-day heatmap + current-session card                                           | M      | done    | 1.10.3        | dashboard        |
| 1.10.6  | Real data · CronRun aggregate (cost today, failures 24h)                                                         | S      | done    | 1.10.3        | dashboard        |
| 1.10.7  | Real data · MCP health pinger (postgres/gsc/ga/dataforseo/sentry) · KV-backed 60s cache                          | S      | done    | 1.10.3        | dashboard        |
| 1.10.8  | Auto-refresh · client-side AutoRefresh component + revalidateTag('dev-dashboard') server action                  | S      | done    | 1.10.4        | dashboard        |
| 1.10.9  | Auto-enhance signals · render from .claude/memory/enhance-signals.json                                           | S      | done    | 1.10.4        | dashboard        |
| 1.10.10 | process-enhancer agent · scheduled daily · clusters incidents · opens self-improvement PRs                       | M      | pending | 1.10.9        | self-improvement |
| 1.11.1  | Prisma `Task` model — id, phase, title, description, effort, status, deps, tags, scoreAvg, ownerSession          | S      | pending | 1.10.5        | task-tracker     |
| 1.11.2  | Backfill seed · parse PLAN.md → Task table · idempotent (status preserved on re-run)                             | S      | pending | 1.11.1        | task-tracker     |
| 1.11.3  | `app/(dev)/dev/tasks/page.tsx` · list view · filter by phase/status/tag · click row → detail                     | M      | pending | 1.11.2        | task-tracker     |
| 1.11.4  | `app/(dev)/dev/tasks/[id]/page.tsx` · detail · sessions worked on it · PRs · scorecard · agents used             | M      | pending | 1.11.3        | task-tracker     |
| 1.11.5  | Edit-in-place · server action writes Task row + regenerates PLAN.md mirror · commits to main                     | M      | pending | 1.11.4        | task-tracker     |
| 1.11.6  | Loop reads next task from DB (not PLAN.md) · writes session → Task linkage on close                              | S      | pending | 1.11.2        | task-tracker     |
| 1.11.7  | Add-task button · user can append new tasks · process-enhancer can append discovered tasks programmatically      | S      | pending | 1.11.5        | task-tracker     |
| 1.11.8  | Link Recent Commits + Open PRs cards to /dev/tasks/[id] when commit message contains phase ID                    | S      | pending | 1.11.5        | task-tracker     |

---

## Phase 2 · External services + cost discipline (week 2)

Goal: every external API has a working `services/{vendor}` adapter with cost tracking.

| ID  | Task                                                                                                  | Effort | Status  | Deps     | Tags |
| --- | ----------------------------------------------------------------------------------------------------- | ------ | ------- | -------- | ---- |
| 2.1 | `lib/cost/cost-counter.ts` — AsyncLocalStorage wrapper, increments open CronRun                       | S      | pending | 0.2      |      |
| 2.2 | `lib/cache/index.ts` — 24h cache helper backed by Vercel KV (cron + adapter use)                      | S      | pending | 2.1      |      |
| 2.3 | `services/dataforseo/` — Maps, Reviews, SERP organic, Local pack, Keyword Volume, Lighthouse adapters | L      | pending | 2.1, 2.2 |      |
| 2.4 | `services/meta-ad-library/` — daily ad scan adapter                                                   | S      | pending | 2.1, 2.2 |      |
| 2.5 | `services/lighthouse/` — wraps DataForSEO Lighthouse + custom DOM checks (schema, NAP, booking CTA)   | S      | pending | 2.3      |      |
| 2.6 | `services/email-verify/` — SMTP verification                                                          | S      | pending | 2.1      |      |
| 2.7 | `services/ai-haiku/` — Anthropic SDK wrapper for sentiment + reply drafts                             | S      | pending | 2.1      |      |
| 2.8 | `services/stripe/` — checkout session, subscription state, webhook handlers                           | L      | pending | 2.1      |      |

---

## Phase 3 · Cron pipeline (week 3)

Goal: 17 cron jobs run on schedule, data lands in DB, CronRun rows audit cost.

| ID   | Task                                                                                 | Effort | Status  | Deps     | Tags    |
| ---- | ------------------------------------------------------------------------------------ | ------ | ------- | -------- | ------- |
| 3.1  | Daily — `/api/cron/daily/brand-hijack-scan`                                          | S      | pending | 2.3      |         |
| 3.2  | Daily — `/api/cron/daily/ad-library-diff`                                            | S      | pending | 2.4      |         |
| 3.3  | Daily — `/api/cron/daily/new-reviews-delta`                                          | S      | pending | 2.3      |         |
| 3.4  | Daily — `/api/cron/daily/indexer-new-businesses`                                     | S      | pending | 2.3      |         |
| 3.5  | Daily — `/api/cron/daily/list-refresh-daily`                                         | S      | pending | 0.2      |         |
| 3.6  | Daily — `/api/cron/daily/google-ads-transparency`                                    | S      | pending | 2.4      |         |
| 3.7  | Weekly — `/api/cron/weekly/business-profile-refresh`                                 | S      | pending | 2.3      |         |
| 3.8  | Weekly — `/api/cron/weekly/reviews-full-pull` + sentiment classify + AI reply drafts | L      | pending | 2.3, 2.7 |         |
| 3.9  | Weekly — `/api/cron/weekly/serp-rank-scan`                                           | S      | pending | 2.3      |         |
| 3.10 | Weekly — `/api/cron/weekly/lighthouse-audit`                                         | S      | pending | 2.5      |         |
| 3.11 | Weekly — `/api/cron/weekly/competitor-diff`                                          | S      | pending | 2.3      |         |
| 3.12 | Weekly — `/api/cron/weekly/snapshot-write` (Mapsly Score + MSI compute)              | L      | pending | 3.7–3.11 | signals |
| 3.13 | Weekly — `/api/cron/weekly/list-refresh-weekly`                                      | S      | pending | 0.2      |         |
| 3.14 | Monthly — `/api/cron/monthly/keyword-volume-refresh`                                 | S      | pending | 2.3      |         |
| 3.15 | Monthly — `/api/cron/monthly/market-census`                                          | L      | pending | 2.3      |         |
| 3.16 | Monthly — `/api/cron/monthly/industry-baseline`                                      | S      | pending | 2.3, 2.5 |         |
| 3.17 | Monthly — `/api/cron/monthly/email-verification`                                     | S      | pending | 2.6      |         |

---

## Phase 4 · Signal vocabulary + Hunter UI (week 4)

Goal: the 60+ signals work end-to-end. Agency Hunter can tune values, save lists.

| ID   | Task                                                                                              | Effort | Status  | Deps | Tags    |
| ---- | ------------------------------------------------------------------------------------------------- | ------ | ------- | ---- | ------- |
| 4.1  | `modules/signals/registry.ts` — canonical filter definitions for all 60+ signals                  | L      | pending | 3.12 | signals |
| 4.2  | `modules/scoring/` — Mapsly Score formula, MSI rank, match score                                  | L      | pending | 4.1  | signals |
| 4.3  | `modules/hunter/groups.ts` — the 8 filter categories with editable rows                           | S      | pending | 4.1  |         |
| 4.4  | Hunter UI at `/(agency)/search` — filter rows, comparator + value, live count, save-as-list modal | L      | pending | 4.3  |         |
| 4.5  | Save-list modal → creates List row → triggers initial list-refresh                                | S      | pending | 4.4  |         |
| 4.6  | Lists page at `/(agency)/lists` — render real lists, hover-clone, "today's new matches" strip     | S      | pending | 4.5  |         |
| 4.7  | List detail at `/(agency)/lists/[id]` — filter row, status tabs, lead rows, bulk-action bar       | L      | pending | 4.6  |         |
| 4.8  | Lead status state machine: NEW → CONTACTED → REPLIED → WON/LOST, manual override                  | S      | pending | 4.7  |         |
| 4.9  | Service templates (8 quick-start bundles) + cross-link from lists                                 | S      | pending | 4.4  |         |
| 4.10 | Global business search bar in topbar (`⌘K`) — looks up by name/URL                                | S      | pending | 2.3  |         |

---

## Phase 5 · Prospect detail + reports (week 5)

Goal: agency can deeply research a single business and generate a pitch artifact.

| ID  | Task                                                                                                 | Effort | Status  | Deps          | Tags |
| --- | ---------------------------------------------------------------------------------------------------- | ------ | ------- | ------------- | ---- |
| 5.1 | Prospect view at `/(agency)/prospect/[businessId]` — hero, top stats, 4 pitch wedges, signal blocks  | L      | pending | 4.1, 4.2      |      |
| 5.2 | "Mark as client" button → adds to agency's client registry → excluded from future lists              | S      | pending | 5.1           |      |
| 5.3 | One-pager PDF generation — render Solea-style template with real business data, write to Vercel Blob | L      | pending | 5.1           |      |
| 5.4 | CSV export — column picker, write to Vercel Blob                                                     | S      | pending | 4.7           |      |
| 5.5 | Shareable link — public route at `/share/[publicShareId]`, view-only, branded, 30d expiry            | S      | pending | 5.1           |      |
| 5.6 | Reports list at `/(agency)/reports` — sent history, regenerate, copy link                            | S      | pending | 5.3, 5.4, 5.5 |      |
| 5.7 | Lists analytics at `/(agency)/list-analytics` — per-list funnel + signal correlation                 | L      | pending | 4.8           |      |

---

## Phase 6 · SMB portal full build (week 6)

Goal: Maria can use Mapsly daily — dashboard, reviews, competitors, search, ads, website, market.

| ID  | Task                                                                                     | Effort | Status  | Deps       |
| --- | ---------------------------------------------------------------------------------------- | ------ | ------- | ---------- |
| 6.1 | SMB dashboard with 6-state KPI bar, alerts feed, top-3 fixes, KPI tiles, score breakdown | L      | pending | 3.12       |
| 6.2 | SMB reviews page — unanswered queue, AI reply panel EN/ES, theme analysis, trend chart   | L      | pending | 3.8        |
| 6.3 | SMB competitors page — head-to-head, service coverage matrix, threat ranking             | L      | pending | 3.11       |
| 6.4 | SMB search visibility — keyword table with local-pack occupants, P0 opportunities        | S      | pending | 3.9        |
| 6.5 | SMB ads page — paradox callout, 14 keyword lanes grid, off-keyword warnings              | S      | pending | 3.2        |
| 6.6 | SMB website health — score rings, Core Web Vitals, 11 ranked issues                      | S      | pending | 3.10       |
| 6.7 | SMB market reality — MSI ranking, market medians, spatial distribution map               | L      | pending | 3.12, 3.15 |
| 6.8 | SMB activity feed — chronological event stream                                           | S      | pending | 3.1–3.13   |
| 6.9 | SMB settings — profile, brand voice, billing                                             | S      | pending | 2.8        |

---

## Phase 7 · Billing + tier enforcement (week 7)

| ID  | Task                                                        | Effort | Status  | Deps |
| --- | ----------------------------------------------------------- | ------ | ------- | ---- |
| 7.1 | Stripe checkout — SMB Paid $29                              | S      | pending | 2.8  |
| 7.2 | Stripe checkout — 4 agency tiers                            | S      | pending | 2.8  |
| 7.3 | Stripe webhook handler — subscription lifecycle events      | L      | pending | 2.8  |
| 7.4 | Tier-ceiling enforcement in cron jobs — pause if budget hit | S      | pending | 7.3  |
| 7.5 | Customer portal redirect — manage card / cancel / upgrade   | S      | pending | 7.3  |
| 7.6 | 30-day money-back implementation                            | S      | pending | 7.3  |

---

## Phase 8 · Observability + launch readiness (week 8)

| ID  | Task                                                                  | Effort | Status  | Deps    |
| --- | --------------------------------------------------------------------- | ------ | ------- | ------- | --- |
| 8.1 | Sentry SDK + source maps · capture all errors                         | S      | pending | 0.1     |
| 8.2 | PostHog (optional) — event tracking for funnel + retention            | S      | pending | 0.1     |
| 8.3 | Admin dashboard at `/admin` — CronRun audit, daily cost, active users | S      | pending | 0.2     |
| 8.4 | `/cost-audit` skill — actual vs budget                                | S      | pending | 0.2     |
| 8.5 | `/api/admin/health` — DB + cron + queue status                        | S      | pending | 0.2     |
| 8.6 | Launch checklist run — security audit, a11y review, payments audit    | L      | pending | 8.1–8.5 |
| 8.7 | Cutover from preview to production · `mapsly.ai` domain               | S      | pending | 8.6     |     |

---

## Backlog · Phase 2+ signal expansions (post-launch)

| ID   | Task                                                   | Effort | Status  | Deps |
| ---- | ------------------------------------------------------ | ------ | ------- | ---- |
| B.1  | Yelp Fusion integration (Phase 2 roadmap signal)       | L      | pending | 7.4  |
| B.2  | Reddit mentions via Apify                              | S      | pending | 7.4  |
| B.3  | News mentions via Google News RSS                      | S      | pending | 7.4  |
| B.4  | TikTok Creative Center                                 | L      | pending | 7.4  |
| B.5  | Booking system detection (Wappalyzer-extended)         | S      | pending | 7.4  |
| B.6  | Instagram Graph API (opt-in engagement)                | L      | pending | 7.4  |
| B.7  | Mindbody / Boulevard / Vagaro booking-loop attribution | XL     | pending | 7.4  |
| B.8  | CallRail / Twilio call-loop attribution                | XL     | pending | 7.4  |
| B.9  | Quote-response time (opt-in mystery shop)              | XL     | pending | 7.4  |
| B.10 | Email-marketing engagement (Mailchimp / Klaviyo)       | L      | pending | 7.4  |

---

## How the loop reads this

The `autonomous-build-loop` skill:

1. Parses this file looking for `status: pending` rows
2. Filters by: all `Deps` are `status: completed`
3. Filters by: effort ≤ `M` (autonomous skips L+ unless explicitly allowed)
4. Filters by: no `human-required` tag
5. Picks the lowest-numbered remaining task
6. Updates status to `in_progress`, commits, starts work
7. On success, updates to `completed`, commits, picks the next one

Single source of truth. Edit this file to change priorities. Don't add comments inside the tables — keep them parseable.

---

## Scorecards · append-only

The `scorer` agent appends a 5-dimension card here per completed task. Aggregate is informational (logged on TaskRun for DORA + trend), not a merge gate. Per `.claude/loop.md` v0.6.1 + Hard Reminder #9.

### Task 2.1 · Cost-counter + CronRun lifecycle (PR #6 · commit 6704fc1)

Date: 2026-05-20 · Scorer: scorer agent · Verdict: **MERGE**

| Dimension    | Score | Justification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completion   | 9     | All required artifacts shipped: cost-counter.ts (AsyncLocalStorage + open/close/withCronRun/withCostCounter + assertCronContext + getCurrentCronRun), no-live-api.ts (requireCronContext + cronHandler with Bearer CRON_SECRET, OK/PARTIAL, itemsProcessed/meta writeback), 32 tests across two suites covering nesting + Promise.all parallel isolation + missing-CronRun throw + fail-no-bill. Slightly above the minimum spec (cronHandler + writeback weren't strictly required). −1 because as-first-written the costUsd-NULL bug meant zero cost would have been tracked in production — caught in review, not shipping.                                                                                                        |
| Quality      | 7     | Idiomatic Node 24 AsyncLocalStorage, no `any` casts, vitest config lands clean as the repo's first. The nullable-costUsd Prisma `{ increment }` over NULL bug is exactly the class of issue an integration test against a real Neon test branch (per `.claude/rules/testing.md` §"No mocking DB") should have caught pre-PR; it surfaced in code-review instead and the mock had to be updated to mimic Postgres NULL semantics — which is a circular fix. Security non-blockers (use `crypto.timingSafeEqual` for bearer compare; consider IP rate-limit on `/api/cron/*` per `security.md` + `scalability.md`) are real defects-in-waiting. Strong recovery in c6ee83e, but "caught in review" is one tier below "caught by tests." |
| Audience-fit | 8     | N/A — backend infrastructure, no SMB/Agency voice surface. Convention score.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Relevance    | 10    | The load-bearing moat piece. `cost-discipline.md` rules #2 + #3 (every adapter cost-tracked; CronRun sacred), every Phase 2 adapter (2.3–2.8), every Phase 3 cron handler (3.1–3.17), and the "no live API in user path" enforcement (`scalability.md`, `performance.md`, `caching.md` Layer 3) all pivot on this lib. Exactly matches the strategic intent.                                                                                                                                                                                                                                                                                                                                                                          |
| Performance  | 8     | One Prisma `update` per external call — bounded, PK-indexed, single roundtrip. AsyncLocalStorage overhead ≈ 0 on Node 24. No N+1, no transaction-holding, no N→handler call blocking. Caveat for high-frequency batch adapters (DataForSEO Keyword Volume @ 1000/call): if `incrementCost` fires per item not per batch, that's 1000 update roundtrips — but that's an adapter-side concern, not a defect of this lib.                                                                                                                                                                                                                                                                                                                |

**Aggregate:** (9 + 7 + 8 + 10 + 8) / 5 = **8.4**

**Recommendation:** merge. CI green (lighthouse FAILED is N/A — no UI routes touched), security-auditor PASS, code-reviewer veto resolved in c6ee83e before merge, no `human-required` tag.

**Follow-up tasks (file as separate PLAN rows, do not block 2.1):**

1. Replace bearer string-compare with `crypto.timingSafeEqual` in `lib/middleware/no-live-api.ts` — `security.md` defense-in-depth
2. Add Upstash rate-limit (200/min) to `/api/cron/*` routes — `scalability.md` § Rate limiting + `security.md`
3. Audit Phase 2 adapter design (task 2.3 onward) to ensure `incrementCost` fires per-batch where the vendor batches (DataForSEO Keyword Volume, Maps Search), not per-item — single Prisma update per adapter call regardless of items
4. Add at least one integration test for `cost-counter.ts` against the Neon test branch (per `testing.md` §"No mocking DB") so the next NULL-semantics-class bug is caught by tests, not review
5. INC- entry: "Prisma `{ increment }` over a nullable Float column yields NULL in Postgres — initialize default columns in `openCronRun` not in the schema default" — encode in `.claude/memory/incidents.md` so the next adapter author doesn't re-discover
