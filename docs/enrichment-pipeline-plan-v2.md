# Enrichment Pipeline — Revised Plan (v2)

> Supersedes the current-state claims in `docs/enrichment-pipeline-architecture.html`.
> That doc's **design** (dependency DAG, credit lifecycle, failure model) is the target. Its **"current state"** is stale — written before the credit/job slices landed. Corrected here against the live code + the shipped new UI (verified by 3 parallel audits, 2026-06-30).

## 0 · The headline correction

The original doc claims 4 subsystems are dead/faked. **3 of the 4 are now LIVE** (built after the doc). The shipped system sits **between** the doc's "current 4.0" and "proposed 8.8" — the money path + progress are real (per-run). So the work is **targeted honesty fixes + a dependency layer**, not a rebuild.

## 1 · Current state (verified)

### ✅ Done & wired

- **Credit spine** — `holdCredits`, `settleRun`/`refundHold` (`reconcileRunCredits`), `CostEstimate` authorize/consume (server re-quote), `AgencyWallet`+`CreditLedger`. _(doc said "dead" — wrong)_
- **`EnrichmentJob` rows written + lifecycled** — `fanOutRun` createMany; 4 per-business families (contacts[+tech], services, reviews, ai*research) + 3 cell families inline (meta/google/serp). *(doc said "0 rows" — wrong)\_
- **Honest enriching progress** — `/api/agency/jobs` does a real `EnrichmentJob.groupBy(family,status)`. _(doc said "faked" — wrong)_
- **Wallet pill live** — available = plan+purchased+rollover−held, polled; hold reflected in seconds.
- **Cron drainer**, reachability gate, reviews state machine, discovery/cell freshness, the full new portal UI.

### ⚠️ Broken / fake / dead-column (the real gaps the new UI exposes)

- **🔴 Lighthouse = billable-but-dead** — quoted + held + the "+ Lighthouse" stage shows, but `buildJobPlan`/WORKER never emit a LIGHTHOUSE job → nothing runs, settles "OK." Orphaned `enrich-lighthouse.ts` (460 lines).
- **🔴 Preview enrich cost is fabricated** — `buildCellEstimates` (biz×0.18) + positional `index%4` freshness, NOT the real `preflightEnrichAction` (which already computes fresh-dedup, but only fires on the Discover-step click). Fake numbers on Preview.
- **🔴 Workbench table hardcodes `ads:false`/`search:false`** — faked negatives; the drawer computes them correctly from real rows. Two surfaces disagree.
- **No coverage matrix** — workbench shows a set-wide "Have N/6" instead of a per-row dot-strip; "enrich-more" is a `<Link>` placeholder. No `/research/:id/coverage` endpoint (the data exists in `EnrichmentJob`).
- **Match% = pain-count heuristic** (`Lead.matchScore` unpopulated); tune values captured but dropped on `loadGoalFrom`, unused in eval.
- **No dependency gating** — `EnrichmentJob` has the old 5-value status (no `BLOCKED`), no `dependsOn`/`idempotencyKey`; services/ai_research can fire before the DOM lands.
- **`familiesForSignals` silently drops ~48%** (the `researches.ts` resolver in progress fixes this).
- **Contacts** — plain `fetch()`, no walled-site fallback (~30% silently zero).
- **`EnrichmentRun.creditsCharged`** dead; settle is per-run not per-job.

### ❌ Missing (designed, never built) — the scale layer

Dependency DAG scheduler, the Boxly NestJS worker + Redis lanes/governor/breakers + crash reclaimer + replicas, `EnrichmentReveal` per-agency billing, `JobEvent`/`DeadLetterJob`/`DfsPingbackEvent`.

## 2 · Architecture decision (the expert call)

The doc's heavy machinery (NestJS worker, Redis governor, reclaimer, replicas) is built for **1,000-lead runs** that exceed Vercel's 300s. **That's a scale need; we're at ~89-business cells.** Deliver **correctness + honesty on the existing cron drainer**; **defer the scale infra** until bulk actually times out. The cron already does dependency-blind draining + basic crash recovery (`reconcileStuck`) — we add the dependency brain to it, not a rebuild.

## 3 · The revised build (reprioritized — "no fake data" first)

The honesty gaps are small + targeted. Lead with them.

- **P0 · Research-dependency resolver** _(in progress)_ — `researches.ts`: every signal declares required research families (required field → no silent drops) + chains (`tech→contacts`); replaces `familiesForSignals`; feeds the fan-out.

- **P1 · The honest-workflow wins** _(highest user value, small, no scale infra)_
  - 🔴 **Route Lighthouse** — wire `enrichLighthouseForBusinesses` into `buildJobPlan`+WORKER so the family actually runs (stop charging for nothing); or, if deferring, stop quoting it.
  - 🔴 **Honest Preview enrich cost** — wire Preview to a real `preflightEnrichAction` (fresh-dedup) or show the owned-free vs new breakdown; kill the `biz×0.18` + positional-freshness fabrication.
  - 🔴 **Fix faked-negative coverage** — compute `ads`/`search` (and all families) in the workbench table from real rows (the drawer already does).
  - **Coverage matrix** — `GET /api/agency/research/:id/coverage` (batched 3-query over the LIVE `EnrichmentJob[businessId,family]` index) → per-row dot-strip + real per-family enrich-more.

- **P2 · Dependency ordering (DAG-lite on the cron)** — `EnrichmentJob` += `dependsOn`/`idempotencyKey`/`scope`/`cellKey`/`freshUntil` + `BLOCKED`/`SKIPPED_CACHED`; fan-out mints logical-key edges in **waves** (W0 roots → W1 DOM-children → W2 ai_research); cron claims only **READY** (deps-terminal + fresh-reprobed); `promoteUnblocked`. So nothing runs before its inputs land.

- **P3 · Eval wiring** — feed real data through `signal-eval.ts` IN the discover/preview/workbench flow; tune values reach eval; match% from a real engine (`match-score.ts`), not the heuristic. Jobs-tray run % from stage rollup (kill the 0/N→N/N jump).

- **Deferred (scale / product decisions — flag, don't build yet):**
  - Boxly worker + Redis lanes/governor/breakers + crash reclaimer + replicas — when 1,000-lead runs time out.
  - **Per-job settle (B1)** + atomic CAS hold + `creditsCharged` writer — current per-run settle is fine at this scale; harden before paid _bulk_.
  - **`EnrichmentReveal` per-agency reveal billing** — a **product decision** (charge-on-cache-reveal = the data moat). Current model charges per-run fetch cost. Needs Viktor.
  - `JobEvent`/`DeadLetterJob`/`DfsPingbackEvent` trace/safety tables.

## 4 · UI/UX reconciliation (shipped vs doc)

| Surface                          | Shipped today                                                 | Verdict → phase            |
| -------------------------------- | ------------------------------------------------------------- | -------------------------- |
| Enriching progress               | REAL per-stage `groupBy` (doc's "faked" obsolete)             | ✅ honest (minus LH label) |
| Wallet / hold                    | REAL, live hold                                               | ✅ honest                  |
| **Preview enrich cost**          | FABRICATED `~` (biz×0.18, positional freshness)               | 🔴 fake → P1               |
| **Workbench coverage**           | set-wide "Have/Not yet"; **hardcodes ads:false/search:false** | 🔴 fake → P1               |
| Coverage dot-strip + enrich-more | NOT built (no endpoint)                                       | ⚠️ build → P1              |
| Lighthouse stage                 | label promises it; never runs per-business                    | 🔴 → P1                    |
| Jobs-tray run %                  | coarse `unitsCompleted` (0/N→N/N)                             | 🟡 → P3                    |
| Match% / tune values             | pain-count heuristic; tune dropped, unused                    | ⚠️ → P3                    |

**Doc edits:** rewrite §00/§01 (credit/job/progress are LIVE, not dead/faked); reframe as "shipped cron loop → proposed DAG/worker"; `touch_draft` stays a separate Touchpoints action (resolves C1); the enum is still the old 5-value set (DAG delta unbuilt).

## 5 · Money-safety invariants (gate any paid _bulk_ run — most apply at scale)

- Conservation `held = charged + refunds + skipped`; per-job idempotent settle (P2/deferred); crash recovery (`reconcileStuck`/lease); no-usable-result refund (contacts 0-reach → refund+hide); **never quote a family the dispatcher can't run** (Lighthouse — P1).

---

_P0 in progress. This drives P1→P3 now; scale layer + reveal-billing deferred with explicit flags. Local + verified until Viktor pushes._
