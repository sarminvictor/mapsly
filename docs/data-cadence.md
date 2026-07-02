# Data collection cadence

> **Regenerated 2026-07-01 from `vercel.json` + `app/api/cron/**`** (WP10-2). This doc is the source of truth for *when* data is collected. A CI assertion (`app/api/cron/**tests**/schedule-resolves.test.ts`) fails the build if any scheduled cron path stops resolving to a route handler, so this table can't silently drift again.

There are **four cadence classes**, not the "daily/weekly/monthly" trio the old doc implied. The dominant collection path for the agency portal is **on-demand**, which the previous version never documented. (Class 2 also now carries three **retention/notification** crons — WP6-2 digest, WP6-3 run-finished, WP6-12 market monitor — that read/notify rather than collect.)

## 1 · On-demand · user-triggered · credit-gated (the agency enrichment rail)

The primary data-collection path. A user click mints a `PENDING` `Discovery` or `EnrichmentRun`; the **internal dispatch cron drains it** (see class 2). No external API ever runs in a user request path (enforced by the AsyncLocalStorage cost counter). Cost is charged against the agency credit wallet (hold → settle → refund). This rail collects: business discovery (Maps), contacts + tech (DOM scan), reviews (DfS Standard queue), Lighthouse, services extraction, AI research, and per-cell ad/SERP market intel.

See `docs/enrichment-architecture.html` (live-state) for the full rail. Freshness gates dedup repeat work to $0.

## 2 · Scheduled crons — **exactly what `vercel.json` runs today**

| Schedule                         | Path                                     | Purpose                                                                                                                                                                                                                             |
| -------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*/2 * * * *`                    | `/api/cron/internal/dispatch`            | Drains PENDING discoveries + enrichment runs; the enrichment job rail (self-chains between ticks).                                                                                                                                  |
| `*/2 * * * *`                    | `/api/cron/internal/run-finished-emails` | **WP6-3** · emails the agency owner once when an `EnrichmentRun` reaches a terminal state (idempotent via an `EnrichmentRun.meta` marker). Resend only — no paid API.                                                               |
| `0 * * * *` (hourly)             | `/api/cron/internal/reviews-reconcile`   | Resolves lost DfS review pingbacks (stale ≥120 min, 24h hard ceiling).                                                                                                                                                              |
| `*/15 * * * *`                   | `/api/cron/process-cold-sequences`       | Cold-email sequence stepper (agency outbound handoff).                                                                                                                                                                              |
| `5,20,35,50 * * * *`             | `/api/cron/poll-cold-inboxes`            | Reply/bounce polling for cold inboxes.                                                                                                                                                                                              |
| `0 6 * * 1` (weekly, Mon 06:00)  | `/api/cron/weekly/market-monitor`        | **WP6-12** · plan-gated ($99+) "why now" timing monitor — competitor-started-ads + dropped-out-of-pack signals per active research, persisted as `market_signal` events. Reads already-refreshed data only (no new external calls). |
| `0 13 * * 2` (weekly, Tue 13:00) | `/api/cron/weekly/market-moved-digest`   | **WP6-2** · weekly "your market moved" digest — one Resend email per agency with a change (new matches / new 1–2★ / competitor ads), suppressed when nothing moved. Runs after the weekly data crons.                               |
| `0 4 * * 0` (weekly, Sun 04:00)  | `/api/cron/weekly/retention-sweep`       | WP9-1 retention: prune terminal `EnrichmentJob` (>30d, FAILED 90d), compact `EnrichmentStageRun`, cap `CellSnapshot`.                                                                                                               |

**That's it — eight.** Anything below is on-disk but **not scheduled**.

## 3 · On-disk handlers NOT currently scheduled

These route handlers exist but have **no `vercel.json` entry** — they run only if invoked manually (admin tool / `curl` with `CRON_SECRET`) or via the Boxly worker. Documented so nobody assumes they run on a timer. To activate one, add it to `vercel.json` crons (the CI test will then require it to keep resolving).

**Weekly (unscheduled):** `weekly/ads-intelligence`, `weekly/ads-meta`, `weekly/business-profile-refresh`, `weekly/cell-aggregate`, `weekly/competitor-diff`, `weekly/contact-enrich`, `weekly/lighthouse-audit`, `weekly/pillar-score`, `weekly/reviews-delta`, `weekly/search-visibility`, `weekly/snapshot-write`

**Monthly (unscheduled):** `monthly/email-verification`, `monthly/industry-baseline`, `monthly/keyword-volume-refresh`, `monthly/services-detect`

**Daily / ops (unscheduled):** `daily/brand-hijack-scan`, `process-enhancer`

> ⚠️ **Known gap (WP0/Part I):** the documented free-fetch→Apify contacts funnel lives in `weekly/contact-enrich`, which is **unscheduled** — so the live agency demand path uses the plain-fetch CONTACTS worker (with a walled-site fallback added in WP1/WP3). Decide per business need: schedule `weekly/contact-enrich`, fold its funnel into the demand worker, or delete it.

## 4 · Boxly worker lanes (DigitalOcean, Redis-driven)

Not cron-scheduled — triggered by app events through `lib/boxly-worker/client.ts`. Runs website/search/ads scans, bulk review pulls, and (per WP3-2) root-family enrichment jobs offloaded from the Vercel rail. No 300s cap.

## Cost discipline

Every scheduled/triggered external call is cost-tracked via `withCostCounter` against a `CronRun`. Tier ceilings enforced. Any single call > $5 needs approval (`docs/permissions.md`).

## When adding a new collection job

1. Write the handler under `app/api/cron/**` (verify `CRON_SECRET`, open/close a `CronRun`).
2. If it should run on a timer, add it to `vercel.json` crons — the CI test `schedule-resolves.test.ts` then guards it.
3. Update this doc's class-2 table (or class-3 list).
4. Follow `.claude/rules/cost-discipline.md` + `.claude/rules/scalability.md` (bounded `take`, resume-from-cursor).
