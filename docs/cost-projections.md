# Cost projections per task · per month · per scale

Per-call cost references from `app/(dev)/dev/queries/cost.ts` and `.claude/rules/cost-discipline.md`. Real spend is tracked in `CronRun.costUsd` (incremented by every adapter via `lib/cost/cost-counter.ts`) and surfaced on the **Cost projection** card at dev.mapsly.ai.

## Vendor unit costs

| Vendor              | Operation              |                        Unit cost | Notes                                  |
| ------------------- | ---------------------- | -------------------------------: | -------------------------------------- |
| **DataForSEO**      | Maps SERP search       |                          $0.0006 | Standard queue (10× cheaper than Live) |
|                     | SERP organic           |                           $0.001 | per query                              |
|                     | Reviews pull (last 20) |                          $0.0006 | per business                           |
|                     | Keyword volume         |                         $0.00001 | per keyword in batch of 1000           |
|                     | Lighthouse audit       |                           $0.005 | per URL                                |
|                     | Local pack scan        |                           $0.001 | per keyword                            |
| **OpenAI**          | gpt-5.4-mini input     |             $0.00015 / 1K tokens | est. — D.8 confirms                    |
|                     | gpt-5.4-mini output    |              $0.0006 / 1K tokens | est.                                   |
|                     | **gpt-5.4-nano input** |         **$0.00003 / 1K tokens** | 5× cheaper if D.8 picks nano           |
|                     | gpt-5.4-nano output    |             $0.00015 / 1K tokens | 4× cheaper                             |
| **Meta Ad Library** | ads_archive query      |                           **$0** | free with verified app                 |
| **Resend**          | Email send             |                          $0.0004 | $20/mo for 50K/mo                      |
| **Stripe**          | Transaction            |                     2.9% + $0.30 | revenue-tied, not cost                 |
| **Apify**           | Compute Unit (CU)      |                         $0.00025 | Phase 2 only                           |
| **GA4 / GSC**       | API call               |                           **$0** | free with service account              |
| **Sentry**          | Error event            |                   $0 up to 5K/mo | $26/mo after                           |
| **Vercel Blob**     | Storage / bandwidth    | $0.15/GB stored, $0.30/GB egress | Phase 5+                               |
| **Neon Postgres**   | Compute hour           |                 free up to 0.5GB | $0.10/CU after                         |
| **Vercel hosting**  | Pro plan               |                      $20/mo flat | needed for Cron beyond limits          |

## Per-task one-time development cost

For initial build (no production traffic, just CI + first integration test per adapter):

| Phase task                              | Vendor            |                    Calls during build |             Cost |
| --------------------------------------- | ----------------- | ------------------------------------: | ---------------: |
| C.3 · DataForSEO adapters (6 endpoints) | DataForSEO        |                 ~60 (10 per endpoint) |           ~$0.20 |
| C.4 · Meta Ad Library                   | Meta              |                                   ~20 |               $0 |
| C.5 · Lighthouse adapter                | DataForSEO        |                                   ~10 |            $0.05 |
| C.6 · Email verify                      | none (SMTP local) |                                     — |               $0 |
| C.7 · OpenAI wrapper                    | OpenAI            |                       ~20 small calls |            $0.05 |
| **D.8 · Model A/B test**                | OpenAI            | 50 reviews × 2 models × 3 tasks = 300 |       **~$0.50** |
| D.6 · Sentiment classifier              | OpenAI            |                       50 test reviews |           ~$0.05 |
| D.7 · Reply drafts                      | OpenAI            |                          50 × 2 langs |           ~$0.10 |
| C.8 · Daily crons (6)                   | DataForSEO + Meta |                       ~100 test calls |           ~$0.30 |
| C.9 · Weekly crons (7)                  | DataForSEO        |                       ~200 test calls |           ~$0.50 |
| C.10 · Monthly crons (4)                | DataForSEO        |                        ~50 test calls |           ~$0.10 |
| **All Phase 1-3 builds combined**       | mixed             |                                     — | **~$2.00 total** |

## Per-business per-month running cost (steady state)

After Phase 3 is shipping in production:

| Cron                                        | Frequency |          Cost per business per run |  Per month |
| ------------------------------------------- | --------- | ---------------------------------: | ---------: |
| Business profile refresh                    | weekly    |                            $0.0006 |    $0.0024 |
| Reviews full pull + AI sentiment + AI reply | weekly    | $0.0006 + (20 × $0.0001) = $0.0026 |    $0.0104 |
| SERP rank scan                              | weekly    |                             $0.001 |     $0.004 |
| Lighthouse audit                            | weekly    |                             $0.005 |     $0.020 |
| Competitor diff                             | weekly    |                            $0.0006 |    $0.0024 |
| Snapshot write (compute only)               | weekly    |                                ~$0 |        ~$0 |
| List refresh weekly                         | weekly    |                $0 (recompute only) |         $0 |
| New-reviews delta                           | daily     |                            $0.0006 |     $0.018 |
| Brand-hijack scan                           | daily     |                            $0.0006 |     $0.018 |
| Ad-library diff                             | daily     |                     $0 (Meta free) |         $0 |
| Google Ads transparency                     | daily     |                                 $0 |         $0 |
| Keyword volume                              | monthly   |              $0.0001 (in 1K batch) |    $0.0001 |
| Market census                               | monthly   |                             $0.001 |     $0.001 |
| Industry baseline                           | monthly   |                            $0.0001 |    $0.0001 |
| Email verification                          | monthly   |                            $0.0004 |    $0.0004 |
| **Per-business per month**                  |           |                                    | **~$0.08** |

## At scale projections

| Scale         |                Active businesses tracked |    Monthly cost | Notes                     |
| ------------- | ---------------------------------------: | --------------: | ------------------------- |
| Dev / staging |                             500 (seeded) |      **$40/mo** | Phase 1 dev environment   |
| Small launch  |    5,000 (claimed SMBs + agency targets) |     **$400/mo** | First 6 months            |
| Real growth   |                                   20,000 |   **$1,600/mo** | Year 2                    |
| Full coverage | 2,100,000 (entire index, weekly refresh) | **$168,000/mo** | NOT realistic — see below |

**The 2.1M scenario is impossible without tiering.** Cost-discipline rules:

1. **Tiered refresh**: Only PAID businesses get full weekly refresh. Free-tier businesses get monthly. Inactive businesses get quarterly.
2. **Wake-on-access**: A business gets refreshed only when an agency adds it to a list OR an SMB claims it. Cold ones stay cold.
3. **Hard daily cap**: `CostBudget.dailyBudgetUsd` per tier. Once hit, cron skips remaining businesses that day.

Realistic projection per tier:

| Tier                   | Budget/mo |  Businesses tracked | Per-bus/mo cost |
| ---------------------- | --------: | ------------------: | --------------: |
| SMB free               |        $0 |   own business only |           $0.08 |
| SMB paid ($29)         |        $5 | own + 3 competitors |           $0.32 |
| Agency Solo ($49)      |       $20 |           250 leads |           $0.08 |
| Agency Growth ($99)    |       $40 |           500 leads |           $0.08 |
| Agency Pro ($249)      |      $100 |         1,250 leads |           $0.08 |
| Agency Boutique ($499) |      $200 |         2,500 leads |           $0.08 |

**Gross margin at $29 SMB tier**: $29 - $5 cost = $24 profit. **83% margin** — healthy.

**Gross margin at $499 Boutique**: $499 - $200 cost = $299 profit. **60% margin** — acceptable.

## What enforces this in the code

| Mechanism                         | Where                               | What it does                                         |
| --------------------------------- | ----------------------------------- | ---------------------------------------------------- |
| `withCostCounter` adapter wrapper | `services/{vendor}/cost-counter.ts` | Increments `CronRun.costUsd` on every call           |
| Open `CronRun` requirement        | `lib/cost/cost-counter.ts`          | Throws if no open CronRun (blocks user-path API use) |
| `$5/call ceiling`                 | `.claude/rules/cost-discipline.md`  | Any single call > $5 needs Viktor approval           |
| `CostBudget.haltThresholdPct`     | Loop pre-flight check               | Halts supervisor if daily spend ≥ 100% budget        |
| 24h cache dedup                   | `lib/cache/index.ts`                | Same input within 24h returns cached                 |
| Tier ceiling check                | `lib/cost/tier-ceiling.ts` (G.3)    | Cron skips business once tier budget exhausted       |

## Health-check ping cost

Service-health pings are HEAD requests to provider root URLs. **They cost $0** at every vendor we use. Concern was GitHub rate limit (5000/hour authenticated). Mitigation:

- Cache `getServiceHealth()` for `minutes` (300s) instead of `seconds` (10s) — drops ping rate 30×
- Skip ping if service is `optional` AND not configured (no point pinging Apify if no token)
- Timeout 2s instead of 4s (faster failover, less wall-clock)

At new cache rate: 13 services × 1 cycle per 5 min = 2.6 pings/min. GitHub usage: ~32/hour out of 5000 budget (0.6%). Healthy.
