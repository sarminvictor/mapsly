# Enrichment cost model

Validated by a live, stage-by-stage cost test (Jun 2026) — every number below was a real provider charge, confirmed against the DataForSEO / Apify / OpenAI accounts. Lead under test: "Daniel Barry III, DDS" (San Francisco dentists cell). See `.claude` memory `scraper-cost-test`.

## Assumptions

- **Website split:** ~70% open (free fetch, $0) / ~30% Cloudflare-walled (residential Apify actor).
- **Review depth** scales with a business's review volume (recency-governed ladder): quiet = depth 50, typical = depth 100, busy = depth 200.
- **Cell sizes:** small 100 · avg 400 · large 1,442 (the SF dentist cell). Miami med-spa cell measured at ~200.
- **⚡ on-demand** = run only for leads the user is actively pitching, never bulk across the cell.
- Apify dashboard runs ~13% above the API-reported number; figures below use the conservative (dashboard-ish) value.

## 1 · Per-stage cost

| #   | Stage                  | Source                               | Scope | Best    | Avg     | Worst  | Notes                                                          |
| --- | ---------------------- | ------------------------------------ | ----- | ------- | ------- | ------ | -------------------------------------------------------------- |
| 1   | Discovery              | DfS Maps `business_listings`         | cell  | $0.04   | $0.13   | $0.45  | $0.01 base + $0.0003/listing (100 / 400 / 1442)                |
| 2   | Contacts + DOM         | free-fetch → Apify actor             | lead  | $0      | $0.004  | $0.013 | open = free; walled = actor ($0.013 single, ~$0.0027 batched)  |
| 3   | Reviews                | DfS Standard task queue              | lead  | $0.004  | $0.0075 | $0.015 | $0.00075/10; Live endpoint is dead; recency-governed           |
| 4   | Tech fingerprint       | reuse captured DOM                   | lead  | $0      | $0      | $0     | pure parse of the DOM we already paid for                      |
| 5   | Services               | OpenAI gpt-5.4-nano                  | lead  | $0.0002 | $0.0003 | $0.001 | open-extraction from the DOM, any category                     |
| 6   | AI research            | OpenAI gpt-5.4-nano                  | lead  | $0.0008 | $0.001  | $0.002 | grounded in the gathered signals                               |
| 7   | Compliance (HIPAA/ADA) | deterministic                        | lead  | $0      | $0      | $0     | pure `detect(evidence)` — no API                               |
| 8   | Meta ads               | Apify actor (per cell)               | cell  | $0.02   | $0.04   | $0.10  | variable — residential-proxy _data_ dominates, not memory×time |
| 9   | Google ads             | DfS `ads_advertisers` + `ads_search` | cell  | $0.004  | $0.012  | $0.02  | cheaper + more reliable than Meta; returns real creatives      |
| 10  | SERP 3-pack + organic  | DfS `maps` + `organic`               | cell  | $0.006  | $0.006  | $0.01  | one query pair → per-business ranks via reverse-attribution    |
| 11  | ⚡ Lighthouse          | DfS (open) / actor (walled)          | lead  | $0.004  | —       | $0.06  | DfS junk on walled sites (audits the CF challenge page)        |
| 12  | ⚡ ranked_keywords     | DfS Labs                             | lead  | $0.014  | $0.014  | $0.014 | per-business organic footprint / est. traffic value            |

## 2 · Cost per lead (always-on = stages 2–7)

| Scenario                   | Make-up                                     | Cost/lead   |
| -------------------------- | ------------------------------------------- | ----------- |
| Best                       | open site (free DOM) + quiet reviews        | **$0.005**  |
| Avg                        | blended 70/30 + depth-100 reviews           | **$0.013**  |
| Worst (always-on)          | walled site (actor DOM) + busy reviews      | **$0.031**  |
| Fully-loaded (pitched, ⚡) | worst + walled Lighthouse + ranked_keywords | **~$0.105** |

Dominant costs: **reviews + the DOM fetch** ≈ 90% of the per-lead total. Everything else is fractions of a cent.

## 3 · Cost per cell

Fixed cell cost (stages 1, 8, 9, 10) + per-lead enrichment × number of leads:

| Cell                              | Fixed cell | + per-lead     | **Total**  |
| --------------------------------- | ---------- | -------------- | ---------- |
| Best (100 leads, mostly open)     | $0.07      | 100 × $0.005   | **~$0.57** |
| Avg (400 leads)                   | $0.19      | 400 × $0.013   | **~$5.4**  |
| Worst (1,442 leads, walled-heavy) | $0.58      | 1,442 × $0.031 | **~$45**   |

The 1,442 cell at _avg_ per-lead is ~$19. In practice you enrich only the ~85% reachable subset, so real spend is lower. Per-cell costs (discovery, Meta, Google, SERP) are monthly and amortize to **<$0.001/lead**.

## 4 · Margin (price $0.05–0.10 / credit; 1 credit = 1 enriched lead)

|                 | Cost/lead | Margin @ $0.05 | Margin @ $0.10 |
| --------------- | --------- | -------------- | -------------- |
| Avg lead        | $0.013    | 74%            | 87%            |
| Worst always-on | $0.031    | 38%            | 69%            |
| Fully-loaded ⚡ | $0.105    | loss           | breakeven      |

## Takeaways

1. **Always-on enrichment is cheap (~$0.013/lead)** → 75–87% margin at current pricing.
2. **Reviews ($0.0075–0.015) and the DOM fetch ($0–0.013) are the only material per-lead costs.** The cost-control work (free-fetch-first, batching, DOM-reuse, $0 tech/compliance, nano for AI) keeps everything else near zero.
3. **The ⚡ on-demand signals are the margin risk** — walled-site Lighthouse ($0.06) and ranked_keywords ($0.014). Keep them selective (pitched leads only) or bill them as extra credits.
4. **Google ads beats Meta ads** on every axis (cost, reliability, data richness); Meta is a fragile browser-scrape that returns advertisers-only.

## 5 · Infrastructure costs (Vercel + Neon + Upstash Redis)

Verified rates (Jun 2026):

| Service        | Key rates                                                                                                                                 | Source              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Vercel (Fluid) | $20/seat/mo (+$20 usage credit) · Active CPU $0.128/CPU-hr · memory $0.0106/GB-hr · invocations $0.60/M · bandwidth $0.15/GB (1 TB incl.) | vercel.com/pricing  |
| Neon (Launch)  | PAYG · compute $0.106/CU-hr · storage $0.35/GB-mo · autosuspend → $0 idle                                                                 | neon.com/pricing    |
| Upstash Redis  | PAYG $0.20/100K commands · storage $0.25/GB (1 GB free) · bandwidth $0.03/GB (200 GB free) · or fixed 250 MB $10/mo                       | upstash.com/pricing |

**Design rule (non-negotiable):** Vercel pauses CPU billing during I/O but keeps billing _memory_ for the whole time a function is alive. So never hold a Vercel function open during an 80s Apify run or a DfS wait — kick the job, return, process on webhook/poll-later. (Our architecture already mandates this.) This keeps Vercel compute near-zero.

Marginal infra per enriched lead:

| Component          | Marginal/lead | Why                                                       |
| ------------------ | ------------- | --------------------------------------------------------- |
| Vercel compute     | ~$0.00002     | long waits offloaded; ~6s nano-wait holds ~1 GB           |
| Neon               | ~$0.0001      | scales to zero; storage = ~200 review rows (~200 KB)      |
| Redis              | ~$0.00002     | ~5–10 commands/lead ($0.20 ≈ 20K leads); DOM never cached |
| **Variable total** | **~$0.0002**  | negligible                                                |

The real infra cost is a **fixed monthly baseline (~$50–150/mo)** that amortizes with volume:

| Leads/mo      | Fixed infra/lead | All-in cost/lead (APIs + infra) |
| ------------- | ---------------- | ------------------------------- |
| 10K (early)   | ~$0.010          | ~$0.024                         |
| 100K          | ~$0.001          | ~$0.015                         |
| 500K+ (scale) | ~$0.0002         | ~$0.0135                        |

**All-in cost per enriched lead ≈ $0.015 at normal scale** (heavier early while fixed costs dominate).

## 6 · Pricing strategy — plans & credits

**1 credit = 1 enriched lead** (always-on bundle: contacts · reviews · tech · services · AI research · compliance + the cell's ad/SERP signals). **All-in cost/credit ≈ $0.015.** Discovery (the raw list) is free.

| Plan     | $/mo | Credits    | $/credit | Cost/credit | Gross margin | Profit/mo @100% use  |
| -------- | ---- | ---------- | -------- | ----------- | ------------ | -------------------- |
| Free     | $0   | 50 once    | —        | $0.015      | —            | acquisition (−$0.75) |
| Solo     | $49  | 600        | $0.082   | $0.015      | 82%          | $40                  |
| Growth   | $99  | 1,600      | $0.062   | $0.015      | 76%          | $75                  |
| Pro      | $249 | 5,000      | $0.050   | $0.015      | 70%          | $174                 |
| Boutique | $499 | 12,000     | $0.042   | $0.015      | 64%          | $319                 |
| Top-up   | —    | per credit | $0.10    | $0.015      | 85%          | —                    |

Profit assumes 100% credit usage (worst case); real SaaS usage 40–60% → higher.

**Strategy:**

1. Credits priced 3–13× over cost → 64–85% gross margin even at full usage; undercuts Apollo (~$0.20–1.00/contact) by 4–10×.
2. ⚡ Deep signals (walled Lighthouse $0.06 + ranked_keywords $0.014 ≈ $0.07) DON'T fit a base credit — charge "Deep research" as +1 extra credit, or gate to Pro/Boutique.
3. Fixed infra (~$50–150/mo) is covered by ~2–4 Solo subs; everything past that is ~75–85% margin.
4. Generosity lever: at $0.015 cost you could double every plan's credits to out-compete Apollo and still hold ~50% margin.
5. Margin grows with scale (fixed infra amortizes) and breakage (unused credits) — early cohorts ~60–70%, mature ~80–90%.
