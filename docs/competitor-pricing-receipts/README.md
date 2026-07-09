# Competitor pricing receipts

Substantiation record for the "Why Mapsly is cheaper" comparison
(`components/agency/billing/WhyCheaper.tsx`) and the strategy doc's Part C4.

FTC substantiation doctrine requires a **reasonable basis to exist before a
comparative price claim is published**, with the burden on the advertiser. This
folder is that basis. Keep it current: any time the shipped table changes a
rival figure, add a dated line here with the source URL, and — ideally — a
screenshot (`origami-2026-07.png`, etc.) captured the same day.

**Re-verify quarterly.** Rival pricing drifts (Origami's ladder already changed
from $80/5,500 credits to $29/2,000 between review cycles). Stale comparative
claims can silently become false.

## As of 2026-07-09

| Rival                                            | What we claim                                                                       | Verified source (2026-07-09)                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Origami** (origami.chat, ex-origamiagents.com) | $0.07–0.12/lead · $0.30+ full · discovery costs credits · crawls Maps               | Free 1,000 one-time · Starter $29/2,000cr · Pro $129/9,000cr · Scale $499/40,000cr (~$0.0125–0.0145/cr); email 3cr, phone 15cr; "0% markup, free if not found"; "searches 50+ sources… Google Maps". https://origami.chat/pricing                                                                               |
| **Apollo**                                       | $49–119 per seat/mo · credits expire monthly · $0.20 overage · $147+/mo for 3 seats | Basic $49 / Pro $79 / Org $119 per user/mo (annual); ~1,000/2,000/4,000 export credits/mo (in-plan ≈$0.03–0.06/export); mobiles ~8× email credits; overage $0.20/credit (min 250/$50). https://www.apollo.io/pricing · https://salesmotion.io/blog/apollo-pricing · https://www.warmly.ai/p/blog/apollo-pricing |
| **Clay**                                         | $185/mo entry · multi-credit stacking · B2B                                         | Launch $185/mo (2,500 data credits) · Growth $495/mo (6,000) · ~$30k/yr enterprise; 2× credit rollover; top-ups at ~30% premium. https://www.clay.com/pricing · https://www.warmly.ai/p/blog/clay-pricing                                                                                                       |
| **ZoomInfo**                                     | ≈$1–3/credit (est.) · quote-only · annual lock · 15–40×                             | ~$14,995/yr entry (5,000 credits ≈ $3.00/cr), Advanced ~$24k/12,000 (~$2.00/cr); overage $0.50–1.50; median contract $31,875 across 1,313 purchases (Vendr). Confidential/per-deal — presented as an estimate. https://www.factors.ai/blog/zoominfo-pricing · https://www.vendr.com/marketplace/zoominfo        |
| **DIY Maps scrapers**                            | $0.003–0.01 / raw record                                                            | Outscraper $3/1K Maps records ($0.003), ~$9–11/1K with emails+validation (~$0.01/lead); D7 Lead Finder $44.99–119.99/mo. https://outscraper.com/pricing/ · https://d7leadfinder.com/                                                                                                                            |
| **Instantly**                                    | _(removed from the shipped table 2026-07-09)_                                       | Was $0.02–0.05; now credit tiers ($47/1,500 ≈ $0.03/verified email, email-only). Removed because it undercuts on raw records and distracts from the local-signal wedge. https://instantly.ai/pricing                                                                                                            |

### Mapsly's own figures (first-party — must stay honest)

- **$0.05–0.08 / delivered lead with contacts** = 1 credit at plan rates
  ($19/250=$0.076 … $299/6,500=$0.046). Source: `modules/cost/pricing.ts`
  `PLAN_CARDS[*].rate`.
- **~$0.28–0.46 fully enriched** = 6 credits (`CREDIT_MEANING.fullEnrichment`)
  × plan per-credit rate. This is the figure that MUST appear alongside the
  delivered-lead price so the Origami "$0.30+ full" comparison is like-for-like
  (the pre-2026-07-09 table showed only the shallow price under a "per enriched
  lead" header — the review's critical finding).
