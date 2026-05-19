# Local Intel — Product Pre-Plan

Working name. Two-sided local SMB intelligence platform. North America scope. Built AI-first on top of the existing Boxly Pro engine.

---

## 0. Executive Summary

**The product:** a two-sided platform where local SMBs see a "Reality Mirror" of how they compare to their local competitors across reviews, ads, web, social, and reputation — and where local marketing agencies see the same data inverted, surfacing high-intent SMBs to pitch.

**The wedge:** med spa vertical, top 4 NA metros to start (LA, Miami, Phoenix, Toronto), expanding to 65 metros × 20+ verticals over 12 months.

**The moat:** ~30 composite signals (multi-source named diagnoses) + Boxly's existing email/cohort/snapshot engine + a public "Top X" SEO content layer that compounds inbound demand.

**The realistic target:** $26k–$50k MRR by end of Year 1, $1M+ ARR by end of Year 2 if conversion math holds.

**The non-obvious unlock:** ~70% of the engine is already built inside Boxly Pro. The new product is a 6-week extract + abstraction job, not a 6-month greenfield build.

---

## 1. Product Vision

### 1.1 The two products, one data engine

| Product | Buyer | Pain | Price | Format |
|---|---|---|---|---|
| **Reality Mirror** | Local SMB owner | "How am I doing vs competitors? What should I fix?" | $39–$149/mo | Self-service dashboard + weekly alerts |
| **Hunter** | Local marketing/SEO/web agency | "Find me SMBs in [vertical] in [city] who need [service]" | $99–$599/mo | Inverted-query lead-gen + outreach assist |

Same data pipeline. SMBs sign up → contribute identity + intent + reviews → agencies pay for that pre-qualified pool. This is the Glassdoor / ZoomInfo flywheel applied to local.

### 1.2 Positioning

**Not** "another lead tool" or "another reputation tool." Position as: *"the only place where local SMBs and the people who serve them see the same numbers."* The differentiator is opinionated expertise — we know which signals matter for which vertical — not a configurable filter UI.

Anti-Clay, anti-Birdeye explicit framing: "We don't give you a search interface. We give you a diagnosis."

---

## 2. Reusable Boxly Pro Engine

This is the single biggest unfair advantage — most of this exists today and can be extracted and abstracted from `Mover` → `Business`.

### 2.1 What's already shipped in Boxly Pro

| Layer | What exists | Reuse |
|---|---|---|
| **Intelligence APIs** | `competitive-ranking`, `reviews/intelligence`, `ads/intelligence`, `search-visibility`, `website/grade`, `signals`, `score/improvements`, `city-overview`, `analytics/profile` | Direct port, rename `[moverId]` → `[businessId]` |
| **AI features** | `reviews/generate-response`, `ads/generate-copy`, AI-suggested actions | Direct port |
| **Cron jobs** | `weekly-snapshots`, `competitor-alerts`, `ad-intelligence`, `serp-tracking`, `pro-reresearch` | Direct port; add per-category weight tables |
| **Schema** | `MoverWeeklySnapshot` (per-business time series), tier subscriptions, `MoverPricingConfig` | Rename, generalize on `Category` × `City` |
| **Email infra** | `EmailCampaign`/`EmailSequence`/`EmailRecipient`/`EmailSend` + `Cohort` filters + `applyTemplate` + Zoho 4-account rotation + RFC 8058 unsubscribe + bot detection + daily caps | Multi-tenant: same code, new sending domain |
| **Worker integration** | Apify Reddit scraping, review re-fetch, AI signal analyzer | Direct port |
| **Auth & billing** | NextAuth magic link, Stripe tier gates (proven $99/mo Pro), `withBusinessAuth` ACL | Direct port |
| **PPR & caching** | Cache tag conventions (`movers`, `mover-{slug}`, `movers-{citySlug}`) | Rename to generic `business-*`, `category-*` |

### 2.2 Known debt to address up-front

- **DataForSEO N+1** on `search-visibility` (16 calls per page load) — must promote `MoverSeoSnapshot` to `BusinessSeoSnapshot` with 7-day cache *before* scaling. Difference between a $200/mo and $20k/mo bill.
- **Component size** — several Pro components >300 lines. Refactor opportunistically during the abstraction pass.
- **Cross-module imports** — `modules/pro/components/leads/*` reaches into `modules/business/*`. Promote shared list components to `components/leads/`.

### 2.3 Sibling-product architecture

Keep both products in one codebase. Extract a shared `packages/business-intelligence` lib. Pro improvements flow into the new product automatically. Email infra runs multi-tenant: `boxly.ca` for movers, new domain for the new product, same `marketing-email.service.ts`.

---

## 3. Vertical Choice — Niche Scoring

### 3.1 Full scoring table

10 dimensions, each 1–10. Higher = more attractive. *Competitive Density* is reversed (low density is good).

| Vertical | Mkt Size | WTP | Signal Rich | Engagement | Decision Speed | LTV | Comp Density⁻¹ | Visual | Trust | Boxly Reuse | **/100** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Med Spa / Aesthetics** | 6 | 9 | 9 | 9 | 8 | 9 | 6 | 10 | 8 | 5 | **79** |
| **Real Estate Agents** | 10 | 7 | 9 | 9 | 7 | 6 | 5 | 8 | 7 | 6 | **74** |
| **HVAC** | 8 | 7 | 8 | 5 | 6 | 8 | 7 | 5 | 7 | 9 | **70** |
| **Chiropractor** | 5 | 8 | 7 | 8 | 7 | 8 | 6 | 7 | 8 | 5 | **69** |
| **Veterinary** | 5 | 8 | 7 | 6 | 6 | 9 | 6 | 8 | 9 | 5 | **69** |
| **Roofing** | 6 | 7 | 8 | 5 | 7 | 7 | 8 | 6 | 6 | 8 | **68** |
| **Plumbing** | 8 | 7 | 7 | 5 | 6 | 8 | 7 | 4 | 7 | 9 | **68** |
| **Auto Repair** | 7 | 6 | 8 | 5 | 6 | 7 | 7 | 7 | 7 | 7 | **67** |
| **Landscaping** | 7 | 5 | 7 | 5 | 6 | 6 | 8 | 8 | 6 | 7 | **65** |
| **Dental** | 7 | 10 | 7 | 4 | 4 | 9 | 3 | 6 | 8 | 5 | **63** |
| **Personal Injury Law** | 5 | 10 | 7 | 4 | 4 | 10 | 4 | 4 | 7 | 6 | **61** |
| **Restaurants (indep)** | 9 | 4 | 9 | 4 | 5 | 4 | 2 | 10 | 5 | 5 | **57** |

### 3.2 Vertical sequencing

| Phase | Verticals | Cities | Cumulative TAM |
|---|---|---|---|
| **Phase 1 (Month 1–2)** | Med spa | LA, Miami, Phoenix, Toronto | ~5k businesses |
| **Phase 2 (Month 3–4)** | + HVAC, Real Estate | Top 8 metros | ~50k businesses |
| **Phase 3 (Month 5–6)** | + Chiropractor, Vet, Roofing | Top 15 metros | ~150k businesses |
| **Phase 4 (Month 7–9)** | + Plumbing, Auto Repair, Dental, Landscaping | Top 30 metros | ~400k businesses |
| **Phase 5 (Month 10–12)** | + 8 more verticals | Full 65 metros | ~2M businesses (indexed, lazy-enriched) |

### 3.3 Cross-vertical conversion multipliers vs Boxly mover baseline

Boxly mover data is the floor (0.1% claim conversion on cold email). Vertical lift multipliers based on owner online-engagement, marketing budget, and decision speed:

| Vertical | Multiplier vs movers | Why |
|---|---|---|
| Med spa | 3–5× | Instagram-native, marketing-aware, owner = decision maker |
| Real Estate | 3–4× | Agents are marketers themselves |
| Chiropractor / Vet | 2–3× | Online-savvy owner-operators |
| Dental | 1.5–2× | High WTP but delegates to office manager |
| HVAC / Plumbing | 1–1.5× | Similar to movers (blue collar, mobile-first) |
| Auto Repair | 0.8–1.2× | Same band as movers |
| Restaurants | 0.5–1× | Operationally crushed, can't engage |

---

## 4. Competitive Landscape

### 4.1 SMB-facing competitors

| Player | Price | Strength | Gap we exploit |
|---|---|---|---|
| **Birdeye** | $299–499/mo | Reputation + messaging | No cross-business benchmarks at affordable tier |
| **Podium** | $289–399/mo | Texting + reviews | No competitor intelligence |
| **Yext** | $199+/mo | Listings management | Stale, no scoring |
| **BrightLocal** | $39–79/mo | Local SEO rank tracking | Agency-skewed, single-vertical-blind |
| **Local Falcon** | $24/mo | GMB grid only | Narrow scope |
| **GatherUp / ReviewTrackers** | $69–149/mo | Reviews only | No multi-signal aggregation |

### 4.2 Agency-facing competitors

| Player | Price | Strength | Gap we exploit |
|---|---|---|---|
| **Clay** | $149–800/mo | Workflow builder over signals | No SMB relationship, generic |
| **Apollo** | $59–149/seat | Contact database | No local intent layer |
| **ZoomInfo** | $15k+/yr | Enterprise contact DB | Not for local SMB targeting |
| **Common Room** | $1k+/mo | B2B SaaS community intent | Not local-SMB-shaped |

### 4.3 The two-sided gap

Nobody runs the same data pipeline on both sides. Birdeye sells to SMBs; their competitor data dies inside the dashboard. Clay sells to agencies; they have no SMB relationship. **The white space: be the source of truth for an SMB's local position AND expose "who's losing" structurally to agencies.** Birdeye Reseller exists but is $7,500+ setup. Our white-label tier targets the long tail at $599/mo.

---

## 5. Signal Architecture

### 5.1 Raw signal sources

| Signal | Source | Cost per business | Already in Boxly? |
|---|---|---|---|
| Business existence + basics | DataForSEO Maps | $0.0015 | ✅ |
| Google reviews + trend + response rate | DataForSEO Maps + Worker | included | ✅ |
| GMB ranking grid (3×3) | DataForSEO Maps Live | $0.005–0.01 | partial |
| Organic SERP per keyword | DataForSEO SERP | $0.0006 | ✅ |
| Backlink profile | DataForSEO Backlinks | $0.001 | available |
| Google Ads — running ads | DataForSEO Google Ads | included | ✅ |
| Meta Ads — running | Meta Ad Library API | **free** | new |
| TikTok ads | Creative Center scrape | partial | skip v1 |
| Yelp listings + reviews | Yelp Fusion API | free 5k/day | new |
| BBB rating | BBB scrape | free | new |
| Trustpilot reviews | Trustpilot API / scrape | varies | new |
| Tripadvisor | scrape | free | hospitality only |
| Lighthouse audit | self-host or PSI API | free | ✅ |
| Tech stack | Wappalyzer (self-host) | free | new |
| WHOIS / domain age | RDAP | free | new |
| DNS history | SecurityTrails | $50/mo flat | new |
| SSL cert changes | Certificate Transparency | free | new |
| Job postings | Indeed/ZipRecruiter scrape, Greenhouse/Lever | free | new |
| News mentions | Google News RSS, NewsAPI | free | new |
| Reddit mentions | Apify actors | already paid | ✅ |
| City permits | Open data portals | free | new |
| Email verification | NeverBounce + own pre-filter | $0.005 | new pre-filter |
| Phone validation | Twilio Lookup | $0.005 | new |
| Contact discovery | Hunter / Apollo / PDL | $0.04–0.15 | new |

**On-demand fully-enriched cost:** ~$0.18–$0.35 per business. With lazy snapshot + caching: ~$0.06–$0.12 per active business per month. 50–100× gross margin at $79/mo SMB price.

### 5.2 Composite signals — the moat

Multi-source named diagnoses. Each one is product vocabulary that becomes searchable, citable, screenshotable. **Score per signal: business impact (1–10) × differentiation vs Birdeye/Clay (1–10) ÷ build effort (S/M/L).**

#### Customer-loss signals (highest emotional conversion)

| Signal | Inputs | Impact | Diff | Effort | Score |
|---|---|---|---|---|---|
| **Stolen Customer Index** | competitor review velocity × proximity × service overlap × sentiment match | 10 | 10 | M | **★★★** |
| **Reputation Drift** | 30-day rolling rating − 90-day rolling | 8 | 7 | S | ★★★ |
| **Quality Leak Detector** | MoM change in negative review topic frequency | 9 | 9 | M | ★★★ |
| **Customer Acquisition Pressure** | (competitor median ad spend ÷ yours) × (competitor velocity ÷ yours) | 9 | 9 | M | ★★★ |
| **Talent Crisis Signal** | open jobs >60d + review mentions of "rude/wait" + velocity decline | 8 | 10 | L | ★★ |

#### Operational signals (high ROI to act on)

| Signal | Inputs | Impact | Diff | Effort | Score |
|---|---|---|---|---|---|
| **Owner Attention Score** | response rate × speed × posting freq × photo recency, vs local leader | 10 | 8 | S | **★★★** |
| **Marketing Spend Wasting Index** | ad spend trend − review/booking velocity trend, normalized | 9 | 10 | M | **★★★** |
| **Conversion Decay** | GMB views trend ÷ GMB action trend | 7 | 8 | S | ★★ |
| **Capacity Mismatch** | (search volume × your impression share) − (review-implied bookings × conversion) | 8 | 9 | M | ★★ |
| **NAP Phantom Score** | inconsistencies across 30 directories / total listings | 7 | 6 | M | ★★ |

#### Competitive signals (loss-aversion triggers)

| Signal | Inputs | Impact | Diff | Effort | Score |
|---|---|---|---|---|---|
| **Local Pack Vulnerability** | (your velocity − top 3 avg) × (your rating − their median) × time | 10 | 9 | M | **★★★** |
| **Competitor Breakthrough Detector** | sudden inflection in any competitor signal | 9 | 9 | M | **★★★** |
| **Brand Hijack Detection** | competitors bidding on your branded keywords | 8 | 10 | S | ★★★ |
| **Competitive Threat Velocity** | Σ (competitor velocity ÷ yours) × distance weight | 8 | 7 | S | ★★ |
| **Cross-Sell Opportunity** | "wish they offered X" mentions + competitor offers X | 7 | 9 | L | ★★ |

#### Forward-looking signals (premium tier value)

| Signal | Inputs | Impact | Diff | Effort | Score |
|---|---|---|---|---|---|
| **Trust Recovery Time** | projected days to rating recovery given current velocity | 8 | 9 | M | ★★ |
| **Vulnerability Forecast** | projected 30-day local pack position from velocity deltas | 9 | 9 | M | ★★★ |
| **Seasonal Demand Mismatch** | your ad spend curve vs Google Trends curve | 8 | 8 | M | ★★ |
| **Storm/Event Demand Forecasting** | weather/event signal × vertical demand pattern | 9 | 10 | L | ★★ |
| **Reputation Recovery ROI** | (cost of responses) vs (predicted uplift × revenue per .1★) | 8 | 9 | M | ★★ |

#### Reputation depth signals

| Signal | Inputs | Impact | Diff | Effort | Score |
|---|---|---|---|---|---|
| **Voice-of-Customer Themes** | AI-extracted top 5 praise + complaint themes vs competitors | 9 | 8 | M | ★★★ |
| **Review Authenticity Score** | clustering on review text + account patterns | 8 | 10 | L | ★★ |
| **Owner-Operator Authenticity** | personal-sounding responses + team mentions + owner photos | 6 | 8 | M | ★ |

#### Strategic signals (enterprise upsell paths)

| Signal | Inputs | Impact | Diff | Effort | Score |
|---|---|---|---|---|---|
| **Acquisition Target Score** | duration × declining-but-not-dead × good location × low engagement | 7 | 10 | M | ★★ |
| **Expansion Readiness** | SoV >25% × velocity >median × no drift × capacity low | 7 | 9 | M | ★★ |
| **Identity Match Confidence** | WHOIS age × DNS history × listing consistency × review depth | 6 | 9 | M | ★★ |

### 5.3 Reddit signal layer (Boxly already has the pipeline)

| Signal type | Use for SMB side | Use for agency side |
|---|---|---|
| Recommendation thread mentions | "You were mentioned 3× this week" | Reputation tailwind score |
| Negative thread mentions | Crisis alert | Hot prospect for reputation tools |
| Unanswered "best [vertical] in [city]?" threads | "Live demand to capture — click to draft reply" | Weekly digest of unanswered demand |
| Price discussion threads | Pricing pressure composite input | Market intel |
| Trending procedure/service mentions | Cross-sell opportunity flag | Pitch new-service campaigns |
| Provider name mentions | Talent retention signal | Reverse poaching intel |

**Critical caveat:** Reddit signal-to-noise is rich in Tier-1 metros (NYC, LA, Toronto, Miami, Chicago, SF), medium in Tier-2, thin in Tier-3 (<500k metro). Make tier transparent in UX.

---

## 6. The 12 "Can't Resist" Buy Triggers

Ranked by conversion impact (estimated lift vs vanilla dashboard):

| # | Trigger | Why it converts | Build effort |
|---|---|---|---|
| 1 | **Secret Shopper Grade** — auto-submit quote requests to their site + competitor's, time the responses, grade quality side-by-side | Undeniable evidence nothing else provides | L |
| 2 | **Stolen Customer Report** — name the actual reviewers who went to competitors | Psychologically devastating | M |
| 3 | **"You'd be #1 if…" Path** — LP-style rank math with specific levers | Gamification + ROI + roadmap in one | M |
| 4 | **Phantom Listings Audit** — 30-directory NAP inconsistency check | "Fix that today" gut reaction | M |
| 5 | **"We just published this" PR Carrot** — public "Top 10 in [City]" page with their rank | Status + traffic + signup ladder | M |
| 6 | **Local Pack Vulnerability Score** with countdown | Loss aversion > gain seeking | S |
| 7 | **Marketing Spend Wasting Index** for businesses running ads | Proves what they already suspect | M |
| 8 | **Capacity Mismatch alert** — unused search demand they could capture | Quantifies the opportunity | M |
| 9 | **Recovery Clock** for businesses with negative reviews | Tangible, time-bound, with control lever | S |
| 10 | **Voice-of-Customer Themes** vs competitors | Specificity no Birdeye dashboard has | M |
| 11 | **Competitor's Playbook Reveal** — what changed when their velocity jumped | Hands them strategy, not data | M |
| 12 | **Before/After Social Card** — auto-generated monthly Instagram post | Free content = irresistibly easy share | S |

**Priority for v1:** ship #1, #2, #3, #6 by end of Week 5. These are the conversion superchargers.

---

## 7. Pricing & Tiers

### 7.1 SMB side — Reality Mirror

| Tier | Price | Includes |
|---|---|---|
| **Free** | $0 | One-time report, blurred competitor names, no alerts |
| **Pro** | $39/mo | Full data, weekly refresh, alerts, AI-suggested actions, single location |
| **Plus** | $89/mo | Up to 3 locations, integrations (Jobber, ServiceTitan, Mindbody webhooks), priority support |
| **Multi-location** | $149+/mo | 5+ locations, white-glove onboarding |

**Add-on:** AI Review Responder $19/mo (already exists in Boxly Pro)

### 7.2 Agency side — Hunter

| Tier | Price | Includes |
|---|---|---|
| **Solo** | $99/mo | 50 leads/mo, one vertical, one metro |
| **Agency** | $299/mo | 500 leads/mo, three verticals, multi-metro |
| **Multi-vertical** | $599/mo | Unlimited verticals, multi-metro, API access, **white-labeled SMB dashboard for their clients** |

### 7.3 Phase 2 monetization

- **Public "Top X in [City]" SEO content** → drives consumer leads we sell back to SMBs (per-lead fee or premium tier)
- **Certified badge** (Month 7–9) — retention + SEO compounding via backlinks, tied to score thresholds
- **Deal flow to brokers / PE / search funds** — $1k–10k/mo per buyer
- **SMB insurer underwriting signal** — enterprise contracts $50k–500k/yr

---

## 8. Outreach Strategy

### 8.1 Lessons from Boxly's 1,712-send campaign

Real Boxly aggregate results: ~31% open, ~2.3% click of sends, 1 conversion (~0.06%), ~2 phone calls (~0.18% reply). Per-cohort breakdown:

| Cohort | Sends | Open | Click | Convert | Score |
|---|---|---|---|---|---|
| C3 Top Performer Unclaimed | 1,156 | 35.9% | 1.1% | 0 | 4/10 — best opens, no proof in email |
| C6 Ghost Listings | 200 | 20.0% | 4.0% | 0.5% | 6/10 — low-friction CTA won |
| C2 Rep Rescue | 18 | 27.8% | 5.6% | 0 | 6/10 — embedded data won click rate |
| C4 Hidden Gems | 295 | 21.7% | 1.0% | 0 | 3/10 — teaching mode, no urgency |
| C5 Big City Climbers | 23 | 30.4% | 4.3% | 0 | n/a — sample too small |

**Diagnostic — what the templates got wrong:**
1. Email *tells* but doesn't *show* — no embedded data viz, just prose
2. CTA is "book 30-min Calendly call" — enormous friction for unknown brand
3. 2–3 competing CTAs per email diffuse the action
4. No urgency mechanism (no deadline, no "your competitor just did X")
5. Trust signal weak — recipient doesn't know who Boxly is

**Diagnostic — what the templates got right:**
1. Personalization tokens deeply plumbed (rating, count, rank, themes, search volume)
2. Subject lines with specific numbers performed best (Cohort 3's 35.9% open)
3. Deliverability stack works — DKIM/SPF/DMARC + Zoho rotation
4. Cohort segmentation is the right shape; some too small to learn from

### 8.2 The structural fix: kill the Calendly CTA

Single design decision worth 3–5× conversion: **the CTA goes to a self-service public report page, not a phone call.** The signup gate happens *after* the aha moment, not before. Embed key data in the email body so the click is "see the full picture," not "trust me on a call."

### 8.3 Rewrite template (apply across all new sequences)

```
Subject: {{businessName}}: you ranked #{{cityRank}} in {{city}} this week

Body (<80 words):
{{businessName}} is currently #{{cityRank}} of {{cityCompetitorCount}}
{{vertical}} in {{city}} based on what Google shows customers.

Top 3 captured ~70% of last month's {{cityTotalSearches}} searches.
You captured the rest.

Your biggest gap vs the leader: {{biggestGapMetric}}
({{yourValue}} vs their {{leaderValue}}).

→ See your full report (no signup): {{publicReportUrl}}

— Viktor
```

### 8.4 GTM channels

**SMB side (Reality Mirror):**

| Channel | Reach | Cost | Ramp |
|---|---|---|---|
| Cold reports as cold email | 100k/mo at peak | $80–120/mo email infra | Week 6 onward |
| Vertical communities (r/30PlusSkinCare, FB groups) | high engagement | free | ongoing |
| Public "Top 10" SEO pages | inbound from consumer searches | minimal | compounds Month 4+ |
| Vertical SaaS partnerships (Boulevard, Mangomint, Jobber) | warm intros | 20–30% rev share | Month 4–9 |
| YouTube ads ($0.02–0.05 CPV) — owner-reaction style | scalable | $200–500/mo experiment | Month 3+ |
| Founder-led demos (early signal capture) | 30–50/mo | time only | Month 1–3 |

**Agency side (Hunter):**

| Channel | Reach | Cost | Ramp |
|---|---|---|---|
| Cold email to ~5k NA local agencies | high response (B2B) | reuses Boxly infra | Week 6 onward |
| LinkedIn direct outreach | agency owners are findable | time | ongoing |
| Affiliate program (30% recurring on SMB signups they refer) | viral | rev share only | Month 3+ |
| AppSumo lifetime deal (controversial, instant cash) | $50–100k overnight | one-time | Month 6–9 optional |
| Conferences (LocalU, MozCon, Brighton SEO) | targeted | $2k–5k each | Month 9+ |
| Slack/Discord communities (LocalSEOGuide, Search Engine Land) | warm | time | ongoing |

---

## 9. Email Infrastructure Decision

### 9.1 Options scored

| Approach | Cold/scraped OK? | Capacity | Setup | Risk | Cost/mo | Score |
|---|---|---|---|---|---|---|
| **Reuse Boxly system on new sending domain** | Yes (own infra) | 600–1,500/day per domain × 3 = 1,800–4,500 | 1 week | Low | $80–120 | **9.5** |
| Instantly.ai | Officially no, in practice yes | 5,000+/day | 2 days | Medium-high | $97–197 | 6 |
| Smartlead.ai | Same as Instantly | 5,000+/day | 2 days | Medium | $39–94 | 6.5 |
| Lemlist | Officially no | 500–2,000/day | 2 days | Medium | $69–129 | 6 |
| Mailchimp / Sendgrid / Resend | **No** (bans cold scraped) | n/a | n/a | Account banned in days | $15–100 | 1 |
| AWS SES DIY | Yes if you handle deliverability | 50k+/day | 4–6 weeks rebuild | High (5% bounce kills account) | $0.10/1k | 4 |
| Postmark | **No** | n/a | n/a | Banned immediately | $15+ | 1 |
| **Hybrid: Boxly infra + Smartlead burst spare** | Yes | up to 7k/day | 1 week | Low | $120–160 | **9** |

### 9.2 Recommended setup

1. Buy main brand domain ($15/yr) + 2 throwaway sending domains with redirects ($30/yr).
2. 4 Zoho Workplace seats per sending domain × 3 = $36/mo.
3. DKIM/SPF/DMARC per domain + mail-tester ≥9.5 gate.
4. 14-day warming protocol (20 → 250/day ramp) using existing `email_account_daily_stats` cap logic.
5. Capacity: 1,200 cold/day sustainable, 2,400/day after warming.
6. Postmark for transactional (signup, billing). Never mix with marketing.
7. Smartlead as hot spare ($39/mo) for burst sending — don't make it primary.

**Total monthly email infrastructure: $80–160 all-in.** Replaces Instantly + Resend + warmup stack that would otherwise be $200–400/mo.

---

## 10. Scale Predictions

### 10.1 Scope at full coverage

| Layer | Count |
|---|---|
| US metros (top 50) | 50 |
| Canada metros (top 15) | 15 |
| Total metros | 65 |
| Relevant local-SMB industries | ~40 |
| Total addressable businesses | ~2,000,000 |
| With findable contact (60%) | ~1,200,000 |
| Verified-deliverable email (50% of findable) | ~600,000 |

**Critical:** 2M is database scope, not email scope. Build company index lazily ($3–5k DataForSEO Maps crawl); only enrich businesses you're about to monetize.

### 10.2 One-time costs

| Item | Cost |
|---|---|
| DataForSEO Maps crawl (2M index) | $3,000 |
| Domain + Zoho + setup | $200 |
| Public "Top 10" SEO seed content gen | $500 |
| Landing pages + brand | $300 |
| Stripe + Calendly + monitoring | $100 |
| Buffer | $1,400 |
| **Total** | **$5,500** |

### 10.3 Monthly infrastructure at steady state (1,000+ paying)

| Line item | Pessimistic | Most Likely | Positive |
|---|---|---|---|
| Postgres + history | $100 | $250 | $400 |
| Compute (Vercel) | $200 | $400 | $700 |
| Background workers (Hetzner) | $80 | $180 | $300 |
| Redis cache (Upstash) | $50 | $100 | $150 |
| CDN / blob | $40 | $80 | $120 |
| Email infra | $90 | $120 | $150 |
| Email verification | $400 | $600 | $1,000 |
| DataForSEO ongoing | $400 | $800 | $1,400 |
| Apify (Reddit + scrapers) | $100 | $250 | $400 |
| SecurityTrails | $50 | $50 | $50 |
| AI costs (Haiku) | $500 | $1,500 | $4,000 |
| Sentry + monitoring | $30 | $80 | $150 |
| Calendly + ops tools | $50 | $100 | $200 |
| Smartlead burst spare | $0 | $39 | $94 |
| **Total monthly** | **~$2,100** | **~$4,550** | **~$9,100** |

### 10.4 Conversion funnel — revised with Boxly + vertical lift

Calibrated to Boxly real data + vertical multiplier + "kill Calendly" funnel fix. At peak monthly send volume of ~33k unique businesses:

| Stage | Pessimistic | Most Likely | Positive |
|---|---|---|---|
| Open rate | 18% | 28% | 35% |
| Click rate (of opens) | 4% | 9% | 14% |
| Click → free report viewed | 60% | 75% | 88% |
| Free reports viewed/mo | 130 | 624 | 1,510 |
| Free → paid conversion | 3% | 8% | 16% |
| **New SMB paid customers/mo at peak** | ~4 | ~50 | ~241 |
| Agency-side new customers/mo at peak | ~1 | ~5 | ~18 |

### 10.5 Year-1 MRR trajectory (compounding, with churn)

| Month | Pessimistic | Most Likely | Positive |
|---|---|---|---|
| M2 | $400 | $1,000 | $2,500 |
| M4 | $900 | $3,500 | $9,500 |
| M6 | $1,500 | $7,800 | $22,000 |
| M9 | $2,400 | $14,200 | $46,000 |
| **M12** | **~$3,200–8,000** | **~$26,000–50,000** | **~$82,000–180,000** |

Pessimistic range reflects movers-floor; upper end reflects med spa/RE vertical lift. Most-likely/positive ranges include funnel fix + vertical mix.

### 10.6 Year-1 P&L

| | Pessimistic | Most Likely | Positive |
|---|---|---|---|
| One-time setup | $5,500 | $5,500 | $5,500 |
| Infra (12mo, ramping) | $18,000 | $38,400 | $74,400 |
| **Total cost** | **$23,500** | **$43,900** | **$79,900** |
| Year-1 revenue (sum of monthly MRR) | $18,000 | $110,000 | $380,000 |
| **Year-1 net** | **−$5,500** | **+$66,000** | **+$300,000** |
| Break-even month | Year 2+ | M5–6 | M3 |

---

## 11. Phased Build Plan (AI-built, weeks not months)

### 11.1 Six-week MVP

| Week | Scope | Concrete deliverables |
|---|---|---|
| **1** | Engine abstraction | `Business`/`Category` generalization of Boxly schema. Promote `MoverSeoSnapshot` → `BusinessSeoSnapshot` with 7-day cache. Multi-tenant email service. New domain DNS + Zoho setup. |
| **2** | First vertical seed | DataForSEO Maps crawl: ~5k med spas across LA + Miami + Phoenix + Toronto. Apply Lighthouse, Meta Ad Library, BBB, Yelp Fusion. Email enrichment + verification. First snapshot. |
| **3** | Reality Mirror v1 | Port Boxly Pro `CompetitiveRankingPage` + `ReviewIntelligencePage` + `WebsiteAuditPage`. Ship 8 Tier-3 composite signals: Owner Attention, Stolen Customer Index, Local Pack Vulnerability, Capacity Mismatch, NAP Phantom, Conversion Decay, Reputation Drift, Marketing Spend Wasting. Public report page (no auth). |
| **4** | Hunter v1 | Inverted query layer over same data. Saved searches → weekly email alerts (reuse `competitor-alerts` cron pattern). Lead export. Stripe tiers wired. |
| **5** | Conversion superchargers | Secret Shopper system (auto-fill site forms, time responses, AI-grade). Public "Top 10 Med Spas in [City]" page generator. "You'd be #1 if…" calculator. |
| **6** | Launch | Reuse Boxly cohort engine, new sending domain. 5k cold reports to med spas + 200 cold emails to aesthetic agencies. Affiliate program (Rewardful/Tolt). |

### 11.2 Year-1 expansion

| Month | Build focus |
|---|---|
| **M2** | Iterate copy + funnel based on M1 conversion data. Add HVAC vertical (3-day customization). |
| **M3** | Add Real Estate vertical. Ship next 8 composite signals. AI Review Responder add-on ($19/mo). |
| **M4** | Public "Top X" pages for all metros × shipped verticals. SEO compounding starts. First vertical SaaS partnership outreach (Boulevard, Mangomint). |
| **M5–6** | Add Chiropractor, Vet, Roofing. Expand to top 15 metros. Test YouTube ad creative. |
| **M7–9** | **Certified Badge launch** (after ~500 SMB customers + public Top-X pages indexed). White-label tier setup. Add Plumbing, Auto Repair, Dental. Expand to top 30 metros. |
| **M10–12** | Add Landscaping + 4 more verticals. Full 65-metro coverage at index level (2M businesses crawled, on-demand enrichment). Storm/event demand forecasting. |

### 11.3 Speed assumptions

AI-assisted development throughout. The 6-week MVP is realistic because:
- ~70% of intelligence engine reuses Boxly Pro APIs verbatim
- Email infra ports from `marketing-email.service.ts` with sender-config swap
- Stripe tiers, auth, cohort filtering, template engine — all reused
- Composite signals are computation over data Boxly already pulls
- New code: per-vertical weights, public report page, Secret Shopper, public Top-X page generator

Human-built equivalent estimate: 4–6 months. AI-built: **6–8 weeks for v1, 12 months for full Year-1 roadmap.**

---

## 12. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Boxly attention split** | High | Sibling-product architecture in same repo; Pro improvements flow both ways. Cap weekly hours on new product until M6 if Boxly Pro KPIs slip. |
| **CAN-SPAM/CASL compliance** | Medium-high | US easy. Canada: rely on "implied consent" for publicly listed business emails; log opt-outs; never re-email Canadian bounce/unsubscribe. /privacy + /unsubscribe live before send 1. |
| **Vertical brand cold-start** | Medium | Cold report contains real recipient data → bypasses "who is this" trust gate. Public "Top X" pages establish brand recognition over months. |
| **DataForSEO cost explosion** | Medium | Lazy enrichment from day one. `BusinessSeoSnapshot` 7-day cache (fix Boxly's N+1 first). Tiered refresh: paying weekly, monitored monthly, tail on-demand. |
| **Yelp TOS** | Low-medium | Don't store Yelp review text long-term — pull live via Fusion, display with attribution. Same for Tripadvisor. |
| **Clay/Birdeye competitive response** | Low-medium | Composite signal vocabulary is the moat; time-series advantage compounds. White-label tier under Birdeye Reseller's $7,500 price floor is the defensive lane. |
| **Email deliverability decay** | Medium | Multi-domain rotation, mandatory 14-day warming, daily caps, mail-tester gates, bot detection (already built in Boxly). |
| **Pessimistic case = burning money** | Medium | Lazy scope; infra costs track demonstrated revenue (Phase 1 = $400/mo burn, not $5k). Phase-gate based on M2 conversion data. |
| **Vertical onboarding cost per category** | Low-medium | 3–5 days of weight calibration + copy customization per new vertical. Promise "the 8 verticals we serve well" not "all SMBs." |
| **LinkedIn / Apollo / Meta TOS** | Low | Don't automate LinkedIn at scale. Use Meta Ad Library only (official API). Apollo via paid API only, not scrape. |

---

## 13. Key Decisions Locked In

1. **Med spa is the first vertical.** Top 4 metros (LA, Miami, Phoenix, Toronto) for v1.
2. **Two-sided from day one.** SMB Reality Mirror + Agency Hunter share one data engine.
3. **Reuse Boxly Pro engine.** Sibling product in same repo with extracted shared lib.
4. **Reuse Boxly email infra on new sending domain.** No Instantly/Smartlead dependency.
5. **Kill the Calendly CTA.** Cold emails point to a public self-service report page; signup gate after aha.
6. **Lazy snapshot strategy.** Index 2M businesses cheaply, enrich only on demand.
7. **Composite signals are the moat, not raw signals.** Lead with named diagnoses (Stolen Customer Index, Owner Attention Score), not metrics.
8. **Public "Top X in [City]" pages from Month 1.** SEO + brand + signup ladder all in one.
9. **Badge launches Month 7–9, not Day 1.** Brand credibility required first.
10. **Pricing: $39/$89/$149 SMB; $99/$299/$599 agency. AI Responder $19 add-on.**
11. **Three-touch sequence with embedded data in body, not "click to see data."**
12. **No human sales rep in v1.** Self-service only. Founder-led demos for first 50 customers as signal capture, not as a model.

---

## 14. Open Questions

1. **Boxly Cohort 1 performance** — not in the stats shared; what was the warm cohort's conversion? Tells us whether funnel design or brand recognition is the bigger limiter.
2. **Phone-call replies → paid conversion** — of the ~2 calls Boxly got, did either convert? Per-send revenue math depends on this.
3. **Brand name for the new product.** Working name = "Local Intel" / "Reality Mirror" / "Mirror Local" — pick before Week 5 (domain purchase deadline).
4. **Capital appetite** — pessimistic case is Year-1 net −$5.5k. Acceptable runway?
5. **White-label tier mechanics** — custom domains? Separate Stripe? Defer to Phase 2 but design for it now.
6. **Insurance / broker enterprise channel timing** — earliest meaningful sell is M9 once we have 6mo snapshot history. Worth pre-seeding relationships earlier?

---

## 15. Success Metrics

| KPI | M3 target | M6 target | M12 target |
|---|---|---|---|
| MRR | $1.5k | $8k | $26–50k |
| SMB paid customers | 15 | 80 | 250–500 |
| Agency paid customers | 3 | 15 | 50–120 |
| Verticals shipped | 1 | 5 | 12 |
| Metros covered (enriched) | 4 | 15 | 30 (65 indexed) |
| Cold reports sent (cumulative) | 8k | 60k | 300k |
| Public Top-X pages live | 8 | 75 | 600 |
| Free-to-paid conversion | 5% | 10% | 14% |
| Monthly churn | <10% | <7% | <5% |
| Avg ARPU (blended) | $65 | $80 | $95 |

---

---

## 16. Tone of Voice & Personalized Landing Architecture (v2 — 2026-05-18)

The early personalized landing experiments (`r.html`) revealed that *visual WOW without rigor breaks trust*. This section locks in the principles that govern every personalized landing from now on.

### 16.1 Tone of voice — 10 hard rules

1. **One signal per block.** No reviews-mentioned-in-five-places. If a fact appears in block 3, it cannot reappear as the headline of block 5.
2. **Outcome over metric.** Mention bookings, patients, revenue *before* grades, scores, ranks. Maria's vocabulary, not the analyst's.
3. **Receipts for every number.** Each claim has a "from {source} · {date}" footer. No exceptions.
4. **ICP vocabulary.** Med spa: "patients", "treatments", "consultations", "providers", "injectables". HVAC: "homeowners", "service calls", "techs". Never "ICP", "MSI", "CTR" in copy.
5. **Diagnosis → Cause → Fix → Impact (D-C-F-I) per problem.** Every gap must come with a fix and an outcome in the ICP's units (patients/revenue).
6. **No fake live.** Refresh cadence stated explicitly. "Updated this week" not "47 min ago" or "live now".
7. **No mocked entities.** If a section requires customers we don't have, replace the frame. "We monitor for you" beats "they track with us" when there are no customers yet.
8. **Plain English.** If a med spa receptionist wouldn't say it, rewrite. Read every section out loud — if it sounds like a deck, cut.
9. **Show the math, not just the number.** Every $-amount has the input → math → output visible somewhere on the page or hover.
10. **Loss aversion at top, gain framing at bottom.** Urgency drives scroll. Aspiration drives signup.

### 16.2 The 8-block architecture (replaces the original v1 landing structure)

| # | Block | Job | What it answers |
|---|---|---|---|
| 1 | **Identity card** | "Yes, that's me." | Name, address, rating, review count, refresh state, composite score (X.X/10), separate MSI rank line |
| 2 | **What you sell × demand** | "They know my business." | Service catalog vs Miami search volume + your rank, color-coded visible/invisible |
| 3 | **Who's running ads against you** | "I'm bleeding traffic and didn't know." | Meta Ad Library + Google Ads — who runs ads on your services, ad copy samples, brand-bid map |
| 4 | **This week's market changes** | "There's actually new stuff." | Honest weekly digest: real timestamps, real changes — never "live" |
| 5 | **Your reviews — what they really say** | "Someone read my reviews." | Theme analysis, unanswered complaints, AI reply preview, sentiment trend |
| 6 | **Diagnosis → Fix → Impact** | "I know what's wrong AND how to fix it AND what I get." | One row per top 4 gaps with D-C-F-I structure. Impact in patients/revenue, not grades. |
| 7 | **Market reality** | "I see my position in the whole city." | Total spas in metro, ads-running count, average rating, trending services, your MSI rank |
| 8 | **What Pro adds + CTA** | "I know exactly what I get for $39." | Outcome-framed, pricing anchor vs alternatives (Birdeye $300, hiring a marketer $3k) |

The radar chart and grade slider both move *inside* block 6 as one combined diagnostic. The "47 spas tracking" social-proof premise goes away entirely until we have real customers.

### 16.3 Applied frameworks

| Framework | What we use it for |
|---|---|
| **StoryBrand** (Donald Miller) | Maria = hero, Mapsly = guide. Never make Mapsly the hero of any sentence. |
| **Jobs-to-be-Done** | Maria's JTBD: "more bookings this month without learning a new dashboard." Every section maps to that job, not to "we have lots of data." |
| **D-C-F-I per block** | Diagnosis → Cause → Fix → Impact in 4 short beats. Never spread across separate sections. |
| **5-second test (Wynter)** | At 5 sec, ICP should answer: (1) what does this do? (2) who's it for? (3) what's next? |
| **Moz Local Search Ranking Factors** | Weights for which signals matter for actual booking impact. |
| **Edward Tufte data-ink** | Strip chart-junk. Every pixel earns its place. |

### 16.4 Data integrity rules

1. **Mark sources on every number.** Even derived numbers carry source attribution.
2. **Distinguish three states:** ✓ verified · derived (computed from verified) · ⚠ estimate (with math shown).
3. **No fabricated reviews/names/timestamps.** Only real anonymized data or clearly-labeled placeholders.
4. **No "live" labels on weekly data.** Refresh cadence honesty.
5. **No social proof we can't substantiate.** No "47 spas tracking with us" until we have 47 spas.
6. **Estimates must show math.** Every $-claim has its inputs visible.
7. **When data is missing, scaffold the block with a "data being collected" state** — never invent the data to fill the UI.

### 16.5 Block construction template (per block)

Every block follows this 4-element template:

```
[ Section label · monospace · uppercase ]
[ Headline · serif · short · plain English ]
[ Section sub · 1–2 sentences · explains what we're showing, not what we found ]
[ Data ]
  → Diagnosis (one sentence, what the data says)
  → Cause (one sentence, why this is the case)
  → Fix (one specific action)
  → Impact (Maria's units — patients, calls, revenue — with math shown)
[ Footer source line · "from DataForSEO · May 17 2026" ]
```

Never break this template. If a section needs different structure, it's probably two sections.

### 16.6 Mistakes to never repeat

These are the specific failures from v1 that v2 must avoid:

- "$18,550 in goodwill" — math doesn't equal revenue; misleading.
- "Live feed · last 6 hours" — we refresh weekly; "live" is dishonest.
- "47 spas tracking with us" — no real customers; fabricated social proof.
- "Mapsly Grade B−" alone — Maria doesn't care about a grade letter, she cares about bookings.
- Five sections about reviews — over-leveraged the data that's easiest to make compelling.
- "47 min ago" timestamp — artificial precision creates false expectations.
- Site speed compared only to Lux — wrong baseline; should be industry p95.
- "Local-market advisor — the kind a big chain has on staff" — 40-word hero sub; Maria reads 8.
- Radar chart in hero position — analyst tool, wrong audience.
- "+$4.2k/mo" without showing math — feels fabricated.

---

## 17. Product Architecture — SMB & Agency Portals (v3 — 2026-05-18)

Built and validated both inside-the-app products. Each portal reflects a fundamentally different mental model of how the user thinks about Mapsly.

### 17.1 SMB portal — "make MY business better"

**Persona:** Maria, owner of a single business (e.g. Solea Brickell Spa). Daily user. Logged in every weekday morning to see what changed in her market.

**Mental model:** Mapsly is her business-intelligence cockpit. She doesn't need to *find* anything — she needs to *fix* what's wrong with the one business she owns.

**Pages (9):**

| Page | Use case | Key signals |
|---|---|---|
| `dashboard.html` | Morning glance · Mapsly Score, top fixes, alerts | Mapsly Score, MSI rank, top-3 fixes, this week's market moves |
| `reviews.html` | Daily — unanswered queue, AI reply drafting | Reviews, reply rate, themes, sentiment, AI drafts EN/ES |
| `activity.html` | Chronological feed of everything that changed | Reviews diff, ads diff, SERP shifts, profile changes, brand hijack |
| `competitors.html` | Head-to-head compare with named competitors | Per-competitor stats, same-bldg flag, service coverage matrix |
| `search.html` | Service × demand keyword visibility | Volume, CPC, rank, local-pack, open-lane detection |
| `ads.html` | Meta + Google paid landscape | Your ads, competitor ads per keyword lane, brand hijack bidders |
| `website.html` | Lighthouse health + 11 ranked fixes | Perf, A11y, SEO, schema, LCP, CLS, INP, NAP |
| `market.html` | Census view — MSI rank in metro, medians | 40-spa census, MSI ranking, market medians, new entrants |
| `settings.html` | Profile, brand voice, billing | Reply tone, signature, languages, $29/mo billing |

**Palette:** Cream (`#faf6f1`) + coral (`#c3553a`) accent. Warm. Friendly.

**Pricing:** $29/mo direct (no trial, no $19 charter offer). 30-day money-back. Annual prepay save $29.

### 17.2 Agency portal — "find qualified prospects for my pitch"

**Persona:** Tom, owner of a small local-marketing agency (e.g. Anchor Local). Daily user. Logged in to see who matched his target criteria overnight.

**Mental model:** Mapsly is his prospecting tool. He doesn't manage individual prospects — he manages **lists** (each list = one pitch). Each list auto-refreshes and surfaces qualified businesses he can reach out to with his existing tools.

**v1 explicitly excludes:** CRM features, outreach/sequence engine, deal pipeline kanban, MRR tracking, deal values, churn-risk scoring, team utilization with revenue. The agency's actual output is a **list of qualified leads** — Mapsly stays the qualifier, the agency owns the touch.

**Pages (7):**

| Page | Use case | Key signals |
|---|---|---|
| `lists.html` | Home — all monitoring lists, today's new matches | Per-list match counts, refresh cadence, today's deltas |
| `list-detail.html` | Inside one list — qualified leads with key stats | Reviews, reply rate, signals (why qualified), contact + verified email |
| `prospect.html` | Single-lead deep-dive before reaching out | Every SMB-style signal framed as "pitch wedge" — D-C-F-I per signal |
| `search.html` | One-off ad-hoc query (save as list optional) | Same filter chips as list-creation |
| `activity.html` | What changed in lists this week (new matches, removals, verifications) | List-add events, list-remove events, email verifications, indexer updates |
| `reports.html` | Export list as CSV / branded PDF / shareable link | CSV with 32-signal column set, branded one-pager, link with white-label |
| `settings.html` | Agency profile, white-label, team, billing | Brand color, custom domain, 4-seat team, $249/mo + $19 white-label |

**Palette:** Cool light gray (`#f6f7fb`) + indigo (`#5b3df5`) accent. Tool-y. Professional. Distinct from SMB so the two portals don't blur.

**Pricing:** $249/mo for 5-seat Growth plan + $19 white-label + $9 custom domain = $277/mo effective.

### 17.3 Signal-coverage decisions per portal

Of 63 collectable signals (excluding 11 roadmap):

- **52 surface in SMB portal** (Maria's diagnostic view)
- **38 surface in Agency portal v1** (Tom's prospecting view)
- **34 in both** — framed differently per audience (e.g. "reply rate 0%" is Maria's biggest problem; for Tom it's a filter)
- **18 SMB-only** — internal scoring, multi-page detailed views, AI reply drafts (out of agency scope)
- **4 agency-only** — match score, list-add/remove events, email verification events

**The agency does NOT see:** Mapsly Score (used internally for match-score ordering only), per-review sentiment, AI reply drafts, projected score-with-fixes, recommended-fixes engine output, market median quartiles, spatial map. These exist for Maria's diagnostic use only.

**The SMB does NOT see:** Match score (agency concept), list-add events, email verification (no concept of cold contact).

See `product/signals-coverage.html` for the full matrix with filterable SMB / Agency columns.

### 17.4 Lessons that drove this architecture

1. **Don't over-engineer agency v1.** First pass had CRM, outreach pipeline, MRR per seat, churn risk. None of that ships before the qualifier-list product is validated.
2. **Data dashboards do not work on dark backgrounds.** First agency pass used the landing-page dark theme. Numbers were hard to read. Switched to light gray + indigo.
3. **The agency's "feature" is the saved-search list, not the filter wall.** Showing 32 signal toggles by default scared the user. Show 5-6 saved lists by default. Filters live inside list-edit.
4. **Same data, different framing.** "0% reply rate" is a Maria-side crisis with an AI reply drafted. It's a Tom-side qualifier with no draft — Tom is selling the audit, not the reply.
5. **Mapsly stops at "qualified lead."** Outreach, replies, posting, deal-closing — all happen in the user's existing tools. We don't compete with the user's email or CRM.

---

*Document version 3.0 — adds Product Architecture (Section 17) covering SMB + Agency portals, signal mapping, and architecture lessons (2026-05-18). Versions 1 (brainstorm 1–15) and 2 (tone-of-voice 16) preserved above.*
