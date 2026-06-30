# Pricing & competitive strategy

The single source of truth for plans, credit pricing, and competitive positioning. Cost backing lives in `docs/enrichment-cost-model.md` (validated by a live cost test, Jun 2026).

> **Unit:** 1 credit = 1 fully-enriched lead (contacts · reviews · tech · services · AI research · compliance + the cell's ad/SERP signals). Discovery (the raw market list) is **free**. ⚡ deep signals (walled-site Lighthouse + ranked_keywords, ~$0.07) cost **+1 extra credit**.
> **Our cost: ~$0.015/credit** all-in at normal scale (external APIs ~$0.013 + infra ~$0.002).

## 1 · Competitive comparison

|                                       | Apollo                                    | Origami                                                                                           | Mapsly (us)                                                        |
| ------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Billing model                         | **per seat**                              | flat subscription                                                                                 | flat subscription                                                  |
| Entry paid plan                       | $49/user/mo (annual; $59 monthly)         | $29/mo                                                                                            | $49/mo                                                             |
| Plan ladder                           | Basic $49 · Pro $79 · Org $119 (per user) | Starter $29/2K · Pro $129/9K · Scale $499/40K                                                     | Starter $19 · Growth $99 · Scale $299                              |
| What 1 credit buys                    | 1 data reveal / export                    | **1 micro-action** (0.5–15 cr/action)                                                             | **1 fully-enriched lead**                                          |
| Credits to fully enrich 1 lead        | 2–4 (email + mobile + export)             | **~20–35** (email 3, phone 15, maps 0.8, tech 1, ads 1+1, traffic 2, reviews 0.2/ea, research 1…) | **1**                                                              |
| Effective $/fully-enriched local lead | $0.10–0.20 (contacts only) (+ per-seat)   | **$0.20 (light) – $0.50 (full)**                                                                  | **$0.037–0.063**                                                   |
| Data depth                            | B2B contacts / firmographics              | per-action enrichment (no local expert layer)                                                     | **local signals** — reviews, ads, SERP, tech, services, compliance |
| Local-business coverage               | weak (LinkedIn-blind to ~70% of local)    | generic via Maps/scrape                                                                           | **native, 2.1M local**                                             |
| Credit expiry                         | expire, forfeited                         | end of cycle                                                                                      | **rollover 60d**                                                   |
| Personalized outreach                 | add-on / weak                             | basic                                                                                             | signal-grounded first-touch                                        |

### Cost to fully enrich ONE local lead (apples-to-apples)

| Component                              | Mapsly         | Origami (credits → $ @ Pro $0.0143) | Apollo                     |
| -------------------------------------- | -------------- | ----------------------------------- | -------------------------- |
| Find business                          | bundled        | 0.8 → $0.01                         | —                          |
| Email + phone                          | bundled        | 18 → $0.26 (phone alone = 15 cr)    | ~$0.10–0.20                |
| Tech + Google ads + Meta ads + traffic | bundled        | 5 → $0.07                           | ✗                          |
| Reviews (~50, analyzed)                | bundled        | 10 → $0.14                          | ✗                          |
| AI research                            | bundled        | 1 → $0.01                           | ✗                          |
| Services + compliance                  | bundled        | ✗ (none)                            | ✗                          |
| **Total / lead**                       | **$0.05–0.08** | **$0.20–0.50**                      | $0.10–0.20 (contacts only) |

**We are 4–10× cheaper per complete local lead than Origami** — they meter every action (verified phone alone is 15 credits / $0.21; reviews are 0.2 credit each), while we bundle a whole lead into 1 credit. Local businesses publish phones publicly, so ours rides the free listing/DOM — no 9-provider B2B phone waterfall.

**Pricing-power insight:** Origami SELLS credits at ~$0.0143 ≈ our COST ($0.015), but their credit is one micro-action worth ~1/30th of ours. We sell a whole-lead credit at $0.042–0.082 and still land 4–10× below their per-lead price → we are underpriced and have room to raise (esp. Pro/Boutique) while staying the value leader.

Sources: apollo.io/pricing + salesmotion.io / saleshandy.com (Apollo 2026); origamiagents.com pricing page (verified 2026 — Starter $29/2K, Pro $129/9K, Scale $499/40K; per-action credit menu).

## 2 · The per-seat wedge (vs Apollo)

Apollo bills per user. A 4-seat agency (our Tom persona):

| Tier                  | Apollo (4 seats)  | Mapsly (flat) | Mapsly saving |
| --------------------- | ----------------- | ------------- | ------------- |
| Basic / Solo          | 4 × $49 = $196/mo | $49/mo        | ~4×           |
| Professional / Growth | 4 × $79 = $316/mo | $99/mo        | ~3×           |

Same team, 3–4× cheaper, plus signals Apollo can't see. This is the headline wedge — lead with it.

## 3 · Our plans (simple — 1 credit = 1 complete lead)

**One rule:** 1 credit = 1 fully-enriched lead — contacts, reviews, tech, ads, SERP rank, services, AI research, compliance, all included. No per-action metering. Discovery (raw list) is free. The expensive ⚡ deep audit (full site-speed + keyword footprint) is included on Growth & Scale only, keeping Starter's per-lead cost safe (~$0.015).

| Plan    | $/mo       | Complete leads/mo | $/lead | Cost/lead | Gross margin             |
| ------- | ---------- | ----------------- | ------ | --------- | ------------------------ |
| Free    | $0         | 50 (one-time)     | —      | $0.015    | acquisition (−$0.75 CAC) |
| Starter | $19        | 300               | $0.063 | $0.015    | 76%                      |
| Growth  | $99        | 2,000             | $0.050 | $0.015    | 70%                      |
| Scale   | $299       | 8,000             | $0.037 | $0.015    | 60%                      |
| Top-up  | $0.10/lead | —                 | $0.10  | $0.015    | 85%                      |

Design principles:

- **Just under Origami at every tier** ($19<$29 · $99<$129 · $299<$499) — easy head-to-head.
- **3–5× more complete leads** than the matching Origami tier (Starter 300 vs ~80) — because our credit is a whole lead, theirs a micro-action.
- **Generous entry on purpose** — $19/300 leads is the land-grab to pull triers off Origami/Apollo. Margin still 76%.
- Margins assume 100% usage (worst case); real usage 40–60% (breakage) → higher.
- Headroom to raise Growth/Scale later (value-priced) without losing the price-leader position — we're still 4–10× below Origami's per-lead cost.

## 4 · Positioning

> "Apollo's price, Origami's automation — but the only one that tells you **why to call** a local business, at the lowest cost per lead, with no per-seat tax."

- Win vs **Apollo**: flat (not per-seat), local signals it's blind to, no credit expiry.
- Win vs **Origami**: 1 credit = 1 full lead (not 5–30 per-action), deeper local + expert layer, lower effective cost.
- The moat is the **signal vocabulary + expert layer** (HIPAA/ADA cues, ad-vs-pixel gaps, review trajectory) — neither competitor computes these for local businesses.

## 5 · Levers & guardrails

- **Generosity lever:** at $0.015 cost we can double every plan's credits and still hold ~50% margin — keep in reserve for a price war or aggressive growth push.
- **Deep-signal surcharge:** ⚡ Lighthouse(walled) + ranked_keywords ≈ $0.07 → bill as +1 credit or gate to Pro/Boutique. Never free inside a base credit (a power user would erode the 64% floor).
- **Breakage upside:** unused credits roll 60d then expire → improves realized margin without an Apollo-style hard forfeit.
- **Scale upside:** fixed infra (~$50–150/mo) amortizes; early cohorts ~60–70% margin, mature ~80–90%.
- **Free-tier optics:** 100 free credits (= 100 full leads) reads competitively against Origami's "1,000 free" (which is only ~100–200 full leads at 5–10 credits each).
