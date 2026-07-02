# Unit economics · agency credit model (WP7-6)

> **Purpose:** make gross margin visible before we change pricing. Numbers pulled from `modules/cost/pricing.ts` (post-WP1-12 reconciliation + WP10-7 cell-price re-derivation, `PRICE_LIST_VERSION` `2026-07-02.1`) + `services/dataforseo/pricing.ts` + verified per-stage COGS (memory: scraper-cost-test). This is the precondition the tracker set for **WP6-8 (credit rollover)** and any tier change. **Viktor: WP10-7 resolved the serp/google_ads call-count discrepancy (flag 2 ✅) and made the walled-Lighthouse ESTIMATE honest (flag 1, partial — settle-side follow-up noted). The 1-credit-vs-3-credit pricing-strategy call (flag 3) is still yours to make before WP6-8 rollover ships.**

## The price unit

- **1 credit = $0.05** (`CREDIT_USD`). The credit is the _price_ unit, not raw COGS.
- Settlement (`reconcileRunCredits`) charges `ceil(totalUsd / 0.05)` where `totalUsd` = the sum of the run's actual per-family charged USD. Sub-cent families round up to whole credits, so short runs are slightly generous to the user and long runs amortize.
- Discovery (mapping the market) is **$0 to the agency** — the acquisition wedge.

## Charged cost + COGS per enrichment family

| Family                | Charged USD (`usdPerUnit`) | Real vendor COGS                                                      | Notes                                                                                                                    |
| --------------------- | -------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| contacts              | $0.008                     | ~$0.010/lead (DOM scan; free-fetch $0, walled Apify ~$0.0027 batched) | contacts+tech collapse to one fetch                                                                                      |
| tech                  | $0.001                     | (same fetch as contacts)                                              | fingerprint off the contacts DOM                                                                                         |
| services              | $0.002                     | ~$0.001 (1 nano LLM call)                                             |                                                                                                                          |
| reviews               | $0.015                     | $0.00075×20 = $0.015 (DfS Standard, ≤45-min SLA)                      | true pass-through                                                                                                        |
| lighthouse            | $0.00425                   | $0.00425 open (DfS Live) **/ $0.06 walled** (Apify actor)             | **walled = a loss** (see flag 1) · WP10-7 set the quote `upperMultiplier` to 14.12 so the ESTIMATE upper bound is honest |
| ai_research           | $0.010                     | ~$0.001 measured (5 nano stages, cached)                              | priced ~10× measured — margin buffer                                                                                     |
| meta_ads (per cell)   | $0.050                     | metered Apify (~$0.02–0.05/run)                                       | amortized across the whole cell                                                                                          |
| google_ads (per cell) | $0.004                     | ~$0.004 actual (1 advertisers + 1 search call)                        | **WP10-7 · re-derived** — was $0.052 (charged as 25 calls); now `adsAdvertisers + adsSearch×1`                           |
| serp (per cell)       | $0.043                     | ~$0.043 actual (3 ranked-keyword pulls)                               | **WP10-7 · re-derived** — was $0.160 (charged as 12 pulls); now `serpLocalPack + serpOrganic + rankedKeywords×3`         |

**A fully-enriched lead** (contacts+tech+services+reviews+lighthouse+ai on an open site) = ~$0.0403 charged USD → **ceil(0.0403/0.05) = 1 credit**. Per-cell families are a one-time market cost amortized across every lead in the cell.

## Margin per plan (open-site leads, cell cost amortized)

| Plan    | Price   | Credits/mo    | $/credit | If a full lead ≈ 1 credit → COGS/lead ~$0.04    | Gross margin/credit                     |
| ------- | ------- | ------------- | -------- | ----------------------------------------------- | --------------------------------------- |
| Free    | $0      | 50 (one-time) | —        | acquisition (real COGS, gated — see WP7-5)      | n/a                                     |
| Starter | $19/mo  | 900           | $0.021   | ~$0.04 COGS billed as 1 credit → charged $0.021 | **negative on a full lead at 1 credit** |
| Growth  | $99/mo  | 6,000         | $0.0165  | same                                            | thin/negative at 1 credit/full-lead     |
| Scale   | $299/mo | 24,000        | $0.0125  | same                                            | thin/negative at 1 credit/full-lead     |

> This table is why the **display convention `CREDIT_MEANING.fullEnrichment = 3`** exists: the cards advertise a full lead as **3 credits** (so $0.021×3 = $0.063/lead vs ~$0.04 COGS → ~35% margin at Starter, better at scale). **The problem: the settle path charges ~1 credit for a full lead, not 3.** So the wallet depletes ~3× slower than the cards imply — generous to the user, but it breaks the margin model the cards are priced on.

## ⚠️ Discrepancies (Viktor decision) — flag 2 ✅ resolved by WP10-7

1. **Walled Lighthouse is a per-lead loss.** Open-site audit ($0.00425) is billed 1 credit ($0.05) — fine. But a Cloudflare-walled site routes to the Apify actor at **$0.06 actual**, still billed within the ~1-credit lighthouse line → **we lose money on walled Lighthouse leads.** **WP10-7 (partial):** the pre-flight quote's `lighthouse.upperMultiplier` is now `14.12` (= 0.06 walled ÷ 0.00425 open), so the ESTIMATE's `upperBoundUsd` is honest for a cell of walled sites and the quote reads "bounded" rather than implying every audit is the cheap open case. The **settle** path still bills the per-job open cost ($0.00425) — actually charging the walled premium at settle needs the LIGHTHOUSE worker to return a walled-specific cost (a separate change, not folded into WP10-7); `walledLimit:1` already caps exposure to one walled audit per run. Remaining options for the settle side: (a) worker returns walled cost → settle bills 2 credits, (b) keep the `walledLimit:1` cap as the containment, or (c) accept it as a small loss-leader. _Recommend (a) as a follow-up._

2. ✅ **RESOLVED (WP10-7)** — **Charged cell COGS now matches the real call count.** `serp` is now priced as `serpLocalPack + serpOrganic + rankedKeywords×3` = **$0.043** (was 12 pulls = $0.16); `google_ads` is now `adsAdvertisers + adsSearch×1` = **$0.004** (was 25 calls = $0.052). Re-derived from the real call graph in `modules/cell-intel/{serp,google-ads}.ts`; `PRICE_LIST_VERSION` bumped to `2026-07-02.1`. Margin tables built from `ENRICHMENT_PRICES` are no longer pessimistic on the cell families.

3. **The 1-credit-vs-3-credit question (the big one).** Reconcile ONE of:
   - **Charge 3 credits per full lead** (make settle bill by "fully-enriched-lead units" not raw ceil'd USD) → matches the cards, restores margin, wallet depletes as advertised.
   - **Keep ~1 credit/full lead** (settle stays USD-based) → then re-advertise the cards as "1 credit ≈ 1 fully-enriched lead" and re-check plan sizes (900 credits = ~900 full leads at Starter, which is very generous at $19).
   - This is a pricing-strategy call, not an engineering one — flagging, not deciding. **Recommend deciding this before WP6-8 rollover ships** (rollover multiplies whichever model is chosen).

## Fair-use clause (for the ToS)

> "Markets over 3,000 businesses, or sustained enrichment exceeding your plan's monthly credits, may be rate-limited or require a plan upgrade. Discovery (market mapping) is always free; enrichment consumes credits per the rates shown at checkout."

## Whale scenario

A Scale agency ($299) enriching 15 metros/month × ~500 full leads = 7,500 full-lead credits (~1 credit each under current settle) → well within 24,000. Under the 3-credit convention that's 22,500 credits — near the cap, which is the _intended_ pressure point. Confirms the 3-credit model is the one the plan sizes were designed around → reinforces resolving discrepancy #3 toward "charge 3 credits/full lead."
