# WP10-8 · DfS Standard queue for cell-intel SERP/ads — DECISION: keep Live

**Status: DECIDED — KEEP LIVE (Viktor, 2026-07-02). Not a deferral; the correct answer.**
Cell intel stays on the DfS **Live** tier. No code change. This replaces an earlier
framing that called it a "PARTIAL follow-up" with a flawed cost rationale.

## The decision and why

The item's own qualifier is "Standard **where latency allows**." For cell intel,
**latency does not allow** — and that's the whole answer:

- **Cell intel runs on the interactive demand path.** `serp`/`google_ads`/`meta_ads`
  collectors run inside `fanOutRun` the moment a user requests a research; the user is
  actively waiting for their market to map.
- **The DfS Standard queue is cheaper *because* it's slow (~45-min SLA).** On Standard,
  the market bands wouldn't appear for up to ~45 minutes during a live research.
  **Users won't wait 40 minutes** — they abandon. The snappy Live market view is worth
  the cost.

## Correcting the earlier rationale (it was wrong)

The first draft deferred this partly because "30-day freshness gates cell intel to $0
on repeat." **That was wrong, and the code proves it:**

- **There is no auto-refresh.** `ads-meta` / `ads-intelligence` / `cell-aggregate` are
  **not scheduled** in `vercel.json`. Cell intel runs **only** on user demand.
- `freshnessDays: 30` is a **dedup** window (same cell re-requested within 30 days →
  $0), **not** an update cycle. In a prospecting tool where agencies explore *new*
  markets, that dedup rarely fires — so most demand pays full Live price.

So keeping Live is **not** because "it's basically free" — it's because **cell intel is
interactive and Standard's latency is unacceptable there.**

## Cost accepted (post-WP10-7, per cell)

`serp` **$0.043** · `google_ads` **$0.004** · `meta_ads` **$0.05** (Apify actor — not a
DfS-Standard candidate at all). Only `serp` is a meaningfully-priced DfS-Standard
candidate; keeping it Live accepts ~$0.043/serp-cell for an instant market view. If a
future **background** market-refresh path is ever added (a cron re-pull NOT on the
interactive path), *that* path would be the right place to use Standard. The seam below
is kept for that hypothetical only.

## The ask (tracker WP10-8, original)

> Run SERP/ads cell intel on the DfS **Standard** queue (`task_post`/`task_get`
> like reviews) instead of the **Live** tier, where latency allows.

## Current state

All four cell-intel SERP/ads adapters call the **Live** endpoints synchronously:

| Adapter          | Endpoint                                          | File                                         |
| ---------------- | ------------------------------------------------- | -------------------------------------------- |
| `serpOrganic`    | `/v3/serp/google/organic/live/advanced`           | `services/dataforseo/serp-organic.ts:73`     |
| `serpLocalPack`  | `/v3/serp/google/maps/live/advanced`              | `services/dataforseo/serp-local-pack.ts:95`  |
| `adsSearch`      | `/v3/serp/google/ads_search/live/advanced`        | `services/dataforseo/ads-search.ts:104`      |
| `adsAdvertisers` | `/v3/serp/google/ads_advertisers/live/advanced`   | `services/dataforseo/ads-advertisers.ts:74`  |
| `rankedKeywords` | `/v3/dataforseo_labs/google/ranked_keywords/live` | `services/dataforseo/ranked-keywords.ts:190` |

The cell collectors (`runSerpForCell` / `runGoogleAdsForCell` / `runMetaAdsForCell`
in `modules/cell-intel/*`) call these **inline** inside
`dispatch.collectCellFamily` and write their results (`SerpResult`,
`BusinessKeyword`, `AdLibraryEntry`, `AdMarketRun`) in the **same call** — a
submit-now / land-now shape.

Only **reviews** already runs on Standard: `services/dataforseo/reviews-task.ts`
(`task_post` → pingback), the webhook at
`app/api/webhooks/dataforseo/reviews/route.ts`, and the durable `ReviewJob` state
machine in `modules/reviews/review-job.ts`
(`SUBMITTED → AWAITING_PINGBACK → FETCHING → DONE/FAILED` + `reconcileStuckReviewJobs`).

## What already exists (the reusable seam)

The plumbing needed for a Standard-queue port is **proven and reusable at the
client layer** — this is what makes the follow-up low-risk once scoped:

1. **`dataforSeoPost` already returns `taskId`** and supports
   `acceptableTaskStatusCodes([20000, 20100])` generically
   (`services/dataforseo/client.ts:116-120, 266, 288`), so a `task_post` variant
   of any endpoint is a thin adapter over the existing client — no client change.
2. **The pingback token + webhook host already exist**
   (`DATAFORSEO_PINGBACK_TOKEN`, `buildReviewsPingbackUrl`,
   `app/api/webhooks/dataforseo/reviews/route.ts`). A generalized cell-intel
   webhook route is additive, not new infrastructure.
3. **The durable-job pattern is proven** (`ReviewJob` + `reconcileStuckReviewJobs`,
   folded into `closeRunIfDone` via `reconcileReviewJobs`). A `CellIntelJob`
   would mirror it.

## Why this is NOT a fold-in (feasibility verdict)

Mirroring the Standard pattern for SERP/ads requires, per family:

1. **New `task_post`/`task_get` adapters** for each endpoint (currently all
   hardcoded `/live/advanced`). DfS SERP **does** offer a Standard `task_post`;
   `ads_search`/`ads_advertisers` Standard availability must be **verified against
   DfS docs** before committing — not assumed.
2. **A new durable job model + migration** (a generalized `CellIntelJob`, or a
   per-family one) mirroring `ReviewJob`. The cell collectors run synchronously
   today; Standard splits them into _submit-now / land-later_, so
   `runSerpForCell` / `runGoogleAdsForCell` must be re-architected to _submit +
   park_, and `closeRunIfDone` needs a `reconcileCellIntelJobs` pass like
   `reconcileReviewJobs`.
3. **A new webhook route** (or a generalized handler) + an in-flight guard. Cells
   have no equivalent of `Business.pendingReviewsTaskId`.
4. **Run-close accounting** currently seeds/increments `actualUsd` synchronously
   at fan-out for cells (WP1-6). Async cell landing needs the same
   AWAITING/reconcile treatment reviews already have (WP1-9), or the run would
   close before the cell data lands.

Net: multi-file, migration-bearing, and it touches the money/close path
(`fanOutRun` / `closeRunIfDone` / `collectCellFamily` / a new reconcile) — exactly
the paths WP1 hardened. Forcing it here risks regressing cell-intel correctness
for a **cost** win, not a correctness or freshness one.

## What we're NOT losing by deferring

The **30-day-freshness** benefit the tracker line implies **already exists**,
independent of the queue tier: `ENRICHMENT_PRICES[family].freshnessDays = 30`
gates every cell family, so a fresh cell is served from the DB at **$0** within
30 days (`isCellRunFresh` / `latestAdMarketRun`). Standard queue's win is purely:

- **Cost** — Standard is ~2× cheaper per call (`serpOrganic` Live $0.002 vs
  Standard $0.0002; `adsSearch`/`adsAdvertisers` Live $0.002 vs Standard $0.0006).
  After **WP10-7** the whole serp cell is $0.043 and google_ads is $0.004 —
  already small, amortized across the cell, and only paid once per 30-day window.
- **Timeout-safety** — a submit/park shape can't hit the 300s function cap. But
  the cell collectors already run on the Boxly worker's own budget when
  `enrichWorkerAvailable()` (WP1-5/WP3-2), so the timeout pressure is already
  largely relieved for the demand path.

Given the win is a modest cost trim on an already-cheap, already-amortized,
already-30-day-cached, already-worker-offloaded path, the risk/reward favors a
**dedicated WP** over folding it into this wave.

## Recommended follow-up (a dedicated WP)

1. Verify DfS Standard `task_post` availability for `ads_search` +
   `ads_advertisers` (SERP + ranked_keywords are confirmed).
2. Add a generalized `CellIntelJob` model + migration mirroring `ReviewJob`.
3. Add `serp*/ads*` `task_post`/`task_get` adapters over the existing client
   (reuse `acceptableTaskStatusCodes([20000, 20100])` + `taskId`).
4. Add a generalized `/api/webhooks/dataforseo/cell-intel` route (token-verified,
   like reviews) that resolves the parked job and lands the results.
5. Re-architect `runSerpForCell` / `runGoogleAdsForCell` to submit + park, and add
   `reconcileCellIntelJobs` to `closeRunIfDone` (mirror WP1-9).
6. Keep **Live** for latency-critical paths (e.g. the daily brand-hijack scan)
   and for `meta_ads` (Apify, not a DfS queue).

**Decision:** defer to a dedicated WP; keep Live for cell intel now. The seam
above (client `taskId` support + pingback token + webhook host + `ReviewJob`
pattern) makes the follow-up contained once the DfS Standard availability check
passes.
