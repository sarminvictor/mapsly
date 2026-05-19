# Mapsly — Full Signals & Features Inventory

Comprehensive mapping of **every signal and feature** discussed across the project, against:
- ✅ Built = exists today in Boxly Pro and can be ported
- 🟡 Partial = data exists but composite/derivation needs work
- ❌ Not built = needs to be implemented
- 🌐 Landing = where it's shown on the marketing pages

Last updated: 2026-05-17.

---

## Executive snapshot

| | Count |
|---|---|
| **Total signals & features discussed** | ~85 |
| **Built in Boxly Pro (✅)** | 42 |
| **Partially built (🟡)** | 14 |
| **Not built yet (❌)** | 29 |
| **Shown on at least one landing page** | 28 |
| **Built but NOT shown on landing** ⚠ gap | 31 |
| **Shown on landing but NOT built** ⚠ risk | 8 |

Two strategic findings up top:

1. **We're underselling what we have.** ~30 things are built and battle-tested in Boxly Pro that we don't surface anywhere on the marketing pages. Most of these are the "boring but valuable" diagnostics that the dashboard delivers in volume — payment methods, year established, BBB rating, weekly snapshot history with 8-week deltas, etc.

2. **We're overselling what we have on a few items.** A handful of landing-page features (Phone Test/Secret Shopper, named Stolen Customer Index with profile-matching, Empty Slots calendar) are *not* in Boxly Pro and need real engineering work before they can deliver what the page promises.

---

## A. Identity & Profile Data

| Signal / feature | Boxly Pro | Landing | Data source | Notes |
|---|---|---|---|---|
| Business name | ✅ | 🌐 r, smb | Google Maps (DataForSEO) | |
| Business address | ✅ | 🌐 r | Google Maps | |
| Category (vertical) | ✅ | 🌐 r | Google Maps `googleCategory` | |
| Phone number | ✅ | — | Google Maps | Shown only as a "check" on Boxly Pro |
| Website URL | ✅ | — | Google Maps | |
| Working hours | ✅ | — | Google Maps `workingHours` | |
| Year established | ✅ | — | Mover form / scraped | Surface as "trust signal" |
| Business description | ✅ | — | Mover form / Google | |
| Logo / photo URL | ✅ | 🌐 r (placeholder) | Manual upload / Google | |
| Subscription tier | ✅ | — | Internal | |
| Insurance status | ✅ | — | Mover form | Boxly Pro tracks this; useful for trust |
| BBB rating + URL | ✅ | — | BBB scrape | A+, A, A-, etc. |
| BBB accredited flag | ✅ | — | BBB | |
| BBB unresolved complaints | ✅ | — | BBB | |
| Long distance flag | ✅ | — | Mover-specific | |
| Service categories (piano, packing, etc.) | ✅ | — | Mover form | Mover-specific; adapts to med spa as "treatments" |
| Payment methods accepted | ✅ | — | Mover form | 6 boolean flags |
| Pricing notes | ✅ | — | Mover form | |
| Crew sizes / rates | ✅ | — | Mover-specific | Med spa: replace with treatment pricing |
| `dataCompleteness` score | ✅ | — | Computed | Useful as a meta-signal |

**Gap insight:** Trust-building signals like *years in business*, *BBB rating*, *insurance*, *payment methods accepted* are powerful for SMBs but absent from landing. Adding 2–3 of these to the personalized landing as "what makes you look credible" cards would lift conversion.

---

## B. Boxly Score / Composite Grade

| Signal / feature | Boxly Pro | Landing | Source | Notes |
|---|---|---|---|---|
| **Boxly Score** (0–10 composite) | ✅ | 🌐 r (as "Mapsly Grade B") | Computed from 6 dimensions | Already abstract-ready; rename to "Mapsly Grade" everywhere |
| Reputation dimension (25%) | ✅ | — | Google rating + review count + BBB | |
| Fair Prices dimension (20%) | ✅ | — | Crew rate vs city median | Mover-specific; med spa = treatment price vs median |
| Reliability dimension (20%) | ✅ | — | Claimed + insurance + BBB + years | |
| Transparency dimension (15%) | ✅ | — | Crew rates, payments, hours, phone, website | |
| Communication dimension (12%) | ✅ | 🌐 indirectly | Response rate + unanswered count | This *is* on landing as "reviews not answered" |
| Responsibility dimension (8%) | ✅ | — | Profile completeness + logo + description + sub tier | |
| Per-dimension pass/fail checks (~40 items) | ✅ | — | All of the above | Granular checklist already exists |
| **Improvement suggestions** (sorted by impact) | ✅ | 🌐 r ("top 3 fixes") | Derived from failed checks | Top 10 returned by API |
| **Projected score** if all improvements applied | ✅ | — | Computed | Show as "your score could be 8.4" |
| **Boxly Score breakdown JSON** stored per business | ✅ | — | `boxlyScoreBreakdown` field | |
| **Score history** (weekly snapshots) | ✅ | — | `MoverWeeklySnapshot` | 8-week history shown in Pro |

**Gap insight:** The "projected score if you fix X, Y, Z" is hugely motivating and we don't show it on the landing. Add a "your score *could* be" badge next to the current grade.

---

## C. Review Intelligence

| Signal / feature | Boxly Pro | Landing | Source | Notes |
|---|---|---|---|---|
| Google rating | ✅ | 🌐 r, smb | Google Maps | |
| Google review count | ✅ | 🌐 r, smb | Google Maps | |
| **Owner response rate** (% answered) | ✅ | 🌐 r ("23%") | Computed | Already comparing to city avg |
| **Unanswered reviews count** | ✅ | 🌐 r ("8 reviews") | Computed | Already returning list |
| **Top positive themes** (AI-extracted) | ✅ | — | `MoverReviewTheme` | "What patients love" — not on landing |
| **Top negative themes** | ✅ | — | `MoverReviewTheme` | "Top complaint pattern" — not on landing |
| Sentiment counts (pos/neg/neutral, 12mo) | ✅ | — | `MoverResearch.positiveReviewCount` etc. | |
| AI review summary text | ✅ | — | `reviewSummaryText` | |
| 12-month review trend (monthly) | ✅ | — | Computed | Sparkline could go on landing |
| **Rating distribution** (5★/4★/3★/...) | ✅ | — | Computed | |
| **Review velocity** (reviews per period) | ✅ | — | Computed | |
| Review length distribution | ✅ | — | Computed | |
| **Owner response time** (avg) | ✅ | — | Computed | Powerful trust signal, hidden |
| **AI-drafted review response** (per review) | ✅ | 🌐 r ("Reply with AI" chip) | OpenAI/Claude | One of the highest-value features |
| Posted-response status tracking | ✅ | — | Internal | |
| Recent review activity flag | ✅ | — | Computed | |
| Reviews with photos count | 🟡 | — | Need to extract | Photos signal trust |
| **Reputation Drift** (30d − 90d rating) | ❌ | — | Time series | Derived from snapshots; easy to compute |
| **Quality Leak Detector** (negative theme MoM delta) | ❌ | — | Theme time-series | Need theme history; not stored yet |
| **Review Authenticity Score** | ❌ | — | Pattern clustering | Detect fake reviews; complex |
| **Trust Recovery Time** | ❌ | — | Predictive | Forecast model needed |

**Gap insight:** Boxly Pro already has named *theme extraction* (e.g., "slow response" mentioned 14×). We don't surface this on the landing. The personalized report should show 2 positive themes + 1 negative theme — that's gold.

---

## D. Competitive Positioning

| Signal / feature | Boxly Pro | Landing | Source | Notes |
|---|---|---|---|---|
| **Market Position Index (MPI)** — composite city rank | ✅ | 🌐 r (as "#4 of 47") | Computed weighted score | Renames to "Mapsly Grade" cleanly |
| MPI weights config | ✅ | — | Constants | Tunable per vertical |
| **You vs city avg vs city best** per dimension | ✅ | 🌐 indirect | Computed for 6 dimensions | Powerful — only partly shown |
| **Strengths list** (where you beat city avg) | ✅ | — | Computed | Not shown on landing |
| **Areas to improve** | ✅ | — | Computed | Not shown on landing |
| **Top 20 movers stats** ("X% of top movers do this") | ✅ | — | Computed | Used in Pro UI as "join the leaders" framing |
| Full city competitor list with per-dim ranks | ✅ | 🌐 r (top 3 only) | Computed | Pro shows entire list |
| **Google reputation rank** (rating × log(reviews) × bonus) | ✅ | — | Computed | Distinct from MPI |
| **Boxly Score rank** in city | ✅ | — | Computed | |
| **Pricing rank** (P20–P80 percentile) | ✅ | — | Computed | Mover-specific |
| **Verdict text** (plain English diagnosis per area) | ✅ | — | Templated | "Your $X/hr is competitive in {city}…" |
| **8-week weekly snapshot history** | ✅ | — | `MoverWeeklySnapshot` | The whole graph view in Pro |
| **Weekly deltas** (rank, reviews, rating, score) | ✅ | — | Computed from snapshots | Powerful "what changed" insight |
| **Stolen Customer Index** (named patient matches) | ❌ (🟡 base data exists) | 🌐 r, smb, index | Competitor review crawl + profile match | Concept works; matching logic needs build |
| **Customer Acquisition Pressure Index** | ❌ | — | Cross-derive ads + review velocity | |
| **Cross-Sell Opportunity** (reviews mention X you don't offer) | ❌ | — | Theme analysis | |
| **Local Influence Network** (reviewers shared with competitors) | ❌ | — | Cross-reference reviewer IDs | |
| **Local Pack Vulnerability** (predictive rank slip) | ❌ | 🌐 index | Time-series competitor velocity | |
| **Competitive Threat Velocity** | ❌ | — | Sum of competitor delta vs yours | |
| **Competitor Breakthrough Detector** | ❌ | 🌐 r ("Glow ran 4 ads") | Track sudden inflection | Partial: we know ad presence from `competitor-alerts` cron |

**Gap insight:** Boxly Pro's competitive engine is far more sophisticated than we're showcasing. The full city-list comparison view, weekly deltas, strengths/weaknesses, and per-dimension verdicts are *the* core dashboard experience and most of them are invisible on landing.

---

## E. Ads Intelligence

| Signal / feature | Boxly Pro | Landing | Source | Notes |
|---|---|---|---|---|
| **City keyword volume + CPC** | ✅ | — | DataForSEO Google Ads + `ad-intelligence` cron | |
| **AdKeyword** stored per city | ✅ | — | `AdKeyword` table | Filterable, dedup'd by volume+CPC |
| **Keyword opportunities** filtered by mover services | ✅ | — | Service flags × keywords | Mover-specific filter; abstract for verticals |
| **Who's running ads in the city** (advertisers list) | ✅ | 🌐 r ("Glow ran 4 ads") | Per-city advertiser data | Need to surface specific competitor in landing |
| **Budget simulator** (spend → estimated clicks) | ✅ | — | Internal calc | Pro feature, hidden from landing |
| **AI ad copy generation** | ✅ | — | OpenAI/Claude | High-value, not on landing |
| **Brand Hijack detection** (competitors bidding on your name) | 🟡 (data is in DataForSEO) | 🌐 r ("3 bidders") | DataForSEO Google Ads | Needs a dedicated query per business |
| **Marketing Spend Wasting Index** | ❌ | 🌐 index | Cross-correlate ad spend trend × review velocity | Needs both time series aligned |
| **Seasonal Demand Mismatch** | ❌ | — | Google Trends × ad spend curve | |
| **Meta Ads detection** (running Meta ads) | 🟡 | 🌐 r | Meta Ad Library (free API) | Not currently wired in Boxly; trivial to add |
| **TikTok ad detection** | ❌ | — | TikTok Creative Center | Skip for v1 (limited data) |

**Gap insight:** Boxly Pro has a real ad intelligence engine. The Meta Ad Library wiring is missing but it's a free API and a single integration sprint. Brand Hijack is *almost* free — DataForSEO ad data already gives you who bids on what, we just need to query it for the business's own brand name.

---

## F. SEO / Search Visibility

| Signal / feature | Boxly Pro | Landing | Source | Notes |
|---|---|---|---|---|
| **Per-keyword SERP position** | ✅ | — | DataForSEO SERP via `search-visibility` route | Has N+1 debt (16 calls per page load) |
| **Per-city SERP snapshot** | ✅ | — | `CitySerpSnapshot` + `serp-tracking` cron | |
| **Top 3 / top 10 visibility share** | 🟡 | 🌐 r ("18% of demand") | Computed | Need to surface as named signal |
| **Search demand vs visibility share** | 🟡 | 🌐 r ("247 searched, you got 44") | Computed | Already personalized landing flagship |
| **Backlink profile** | ❌ | — | DataForSEO Backlinks (cheap, $1/1k) | Not wired in Boxly yet |
| **NAP Phantom Score** (listing inconsistencies across 30 directories) | ❌ | — | Multi-directory crawl | Big project |
| **Schema markup audit** | ❌ | — | Lighthouse extension | |
| **GMB ranking grid (3×3 around address)** | ❌ | — | DataForSEO Maps Live | Expensive ($0.005–0.01/grid) |
| **Capacity Mismatch** (demand × your share — booking capacity) | ❌ | 🌐 smb, index | Search vol × visibility share | We have inputs; not derived as named signal |

**Gap insight:** The Search Visibility page exists but has known performance debt. Fixing the cache (the `MoverSeoSnapshot` → `BusinessSeoSnapshot` 7-day cache) is the unlock for scaling. We're showing search-vs-visibility data on the personalized landing — verify the math is real-time, not stale, before scaling.

---

## G. Website Audit

| Signal / feature | Boxly Pro | Landing | Source | Notes |
|---|---|---|---|---|
| **Lighthouse grade** | ✅ | 🌐 r ("41 vs 87") | Self-hosted Lighthouse via `website/grade` route | Live |
| Page speed (load time) | ✅ | 🌐 r ("5.8s vs 1.4s") | Lighthouse | |
| Mobile friendly check | ✅ | 🌐 r | Lighthouse | |
| Booking-on-first-scroll heuristic | 🟡 | 🌐 r | Lighthouse + DOM heuristic | Needs explicit check |
| **Conversion Health Score** (composite of speed + CTA + mobile) | 🟡 | — | All above + form check | Easy composite |
| Web tech stack detection | ❌ | — | Wappalyzer (free, self-host) | High-signal for switching plays |
| WHOIS / domain age | ❌ | — | RDAP (free) | |
| DNS history | ❌ | — | SecurityTrails ($50/mo flat) | |
| SSL cert change detection | ❌ | — | Certificate Transparency (free firehose) | Real-time launch signal |

**Gap insight:** The Lighthouse grade flow is solid and well-shown. Tech stack + WHOIS + DNS = three free signals that unlock huge competitor-tracking power and we have *none* of them wired.

---

## H. Lead / Intent Signals (Demand-side)

| Signal / feature | Boxly Pro | Landing | Source | Notes |
|---|---|---|---|---|
| **Reddit signal scraping** | ✅ | — | Apify actors → `Signal` table | Movers-only for now; med spa would add new subs |
| **Kijiji / Facebook Marketplace / Realtor scraping** | ✅ | — | Apify | Mover-specific sources |
| **AI signal analyzer** (score + stage classification) | ✅ | — | `ai-signal-analyzer.ts` | Reusable for any vertical |
| Signal stages: URGENT / DECISION / CONSIDERATION / AWARENESS | ✅ | — | Internal | Translates to all SMB markets |
| **Estimated move date + confidence** | ✅ | — | LLM extraction | Med spa equivalent: estimated treatment date |
| **Move date proximity boost** (within 14 days → upgrade stage) | ✅ | — | Computed | |
| **Per-mover signal actions** (contacted / not relevant / saved) | ✅ | — | `MoverSignalAction` | Kanban workflow |
| **Stage counts** for tab badges | ✅ | — | Computed | |
| **Source breakdown** | ✅ | — | Computed | |
| **Reddit Q&A community mirror** | ✅ | — | Apify Reddit webhook | "Live demand" capture |
| **Provider name mentions** (talent signal) | ❌ | — | LLM extraction from Reddit | High-value for med spa |

**Gap insight:** The entire lead signal engine exists for movers and is mover-specific. For med spa, we'd add new sub-Reddits (r/30PlusSkinCare, r/SkincareAddiction, r/[city]) and re-tune the LLM scorer — a 1–2 week port, not a rebuild.

---

## I. Customer / Patient Loss Signals

| Signal / feature | Boxly Pro | Landing | Source | Notes |
|---|---|---|---|---|
| **Competitor review crawl** (their new reviews) | ✅ | — | Worker re-fetch | We see them, just don't surface |
| **Named lost patients with quotes** | 🟡 | 🌐 r, smb, index | Competitor reviews | Have data; need profile-match logic |
| **Estimated revenue lost** ($-amount) | ❌ | 🌐 r, smb | Computed from avg ticket × lost count | Needs vertical avg-ticket lookup |
| **Profile match scoring** (does this reviewer match yours?) | ❌ | — | Reviewer pattern + service overlap | The hard part of "Stolen Customer Index" |
| **Why they left** (LLM-extract reason) | 🟡 | 🌐 r, smb | Review text + LLM | Already in `MoverReviewTheme`; needs per-competitor view |

**Gap insight:** This is the single most emotionally compelling section of the landing — and the matching logic is *not* built. Building it well requires ~2 weeks of engineering: extract reviewer features, score similarity, surface top-N matches per business per month.

---

## J. Predictive / Forward-looking

| Signal / feature | Boxly Pro | Landing | Source | Notes |
|---|---|---|---|---|
| **Vulnerability Forecast** (30-day rank change) | ❌ | 🌐 index | Snapshot deltas + competitor velocity | Need ≥4 weeks of snapshots |
| **Trust Recovery Time** | ❌ | — | Rating recovery model | |
| **Storm/Event Demand Forecasting** | ❌ | — | Weather/news × vertical pattern | Roofing especially |
| **Acquisition Target Score** | ❌ | — | Composite | Sell to brokers/PE |
| **Expansion Readiness Score** | ❌ | — | Composite | Multi-location upsell |
| **Identity Match Confidence** | ❌ | — | WHOIS + DNS + listing consistency | Insurance B2B angle |
| **Talent Crisis Signal** | ❌ | — | Open jobs + complaint themes + velocity | |
| **Pricing Pressure Signal** | ❌ | — | "expensive" mention trend + competitor spend | |

**Gap insight:** All predictive signals require time-series data we're accumulating now (Boxly already has 8 weeks of snapshots for some movers). These compound in value over months — Year 1 they're directional, Year 2 they're real predictions.

---

## K. Operational / Diagnostic Signals

| Signal / feature | Boxly Pro | Landing | Source | Notes |
|---|---|---|---|---|
| **Owner Attention Score** | 🟡 | 🌐 index (renamed) | Response rate × speed × posting × photos | Boxly has the inputs, not the composite |
| **Conversion Decay** (GMB views ÷ actions trend) | ❌ | — | GMB Insights API or DataForSEO | Need GMB API access |
| **Marketing Lever Effectiveness** (causal attribution) | ❌ | — | Action log × rank delta | Long-term, needs history |
| **Phone Test / Secret Shopper** | ❌ | 🌐 smb (REMOVED in critique) | Auto-form-submission + grading | Drop for MVP |
| **Empty Slots / Capacity** | 🟡 | 🌐 smb | Search peaks × visibility | Have search peaks; calendar integration is V2 |
| **Voice-of-Customer Themes vs competitors** | 🟡 | — | Theme extraction × competitor themes | Have per-mover themes; need competitor cross-compare |

**Gap insight:** The Phone Test is the riskiest "shown but not built" signal. We removed it from the SMB landing already. Empty Slots needs reframing as "demand peaks vs your visibility" (which we have) instead of literal calendar slots (which we don't).

---

## L. Outreach / Action Features

| Signal / feature | Boxly Pro | Landing | Source | Notes |
|---|---|---|---|---|
| **AI Review Response generator** | ✅ | 🌐 r, smb | Claude/OpenAI | $19/mo add-on planned |
| **AI Ad Copy generator** | ✅ | — | Claude/OpenAI | Hidden from landing |
| **Competitor Alert email** (weekly delta) | ✅ | — | `competitor-alerts` cron | Powerful retention loop |
| **Weekly Reality Report email** | 🟡 | 🌐 r ("save my report") | New | Needs build for new product |
| **Brand Hijack alert** | ❌ | 🌐 r | DataForSEO query + email | Easy add |
| **"Your competitor just did X" alert** | 🟡 | — | Cron + email | `competitor-alerts` is the basis |
| **Monthly Instagram scorecard** | ❌ | 🌐 smb | Image generator | New build; small lift |
| **Public "Top 10 in [City]" page** | 🟡 (movers has it via marketplace) | 🌐 index hint | New SEO route | Existing marketplace pages = similar |
| **"You'd be #1 if…" calculator** | 🟡 | — | Score improvements API | We have inputs; need UI |
| **Storm/Event proactive alert** | ❌ | — | Weather API + vertical rules | |

**Gap insight:** The competitor-alerts cron is one of the most retention-relevant features Boxly Pro has and we don't market it. Adding a "Get weekly competitor moves in your inbox" callout to Pro pricing is free conversion.

---

## M. Quote & Booking Tools (mover-specific — likely SKIP for med spa MVP)

| Feature | Boxly Pro | Landing | Notes |
|---|---|---|---|
| Quote generation (PDF, email, public link) | ✅ | — | Mover-specific; deep build |
| Quote status lifecycle (DRAFT→SENT→VIEWED→WON/LOST) | ✅ | — | |
| Quote follow-up cron (24h/72h) | ✅ | — | |
| Public hosted quote (`/q/[publicId]`) | ✅ | — | |
| Booking calendar + availability | ✅ | — | |
| Mover-branded public booking page | ✅ | — | Reusable as "claim your branded page" |
| Lead editor + photo gallery | ✅ | — | |
| Mover pricing override (per-mover rates) | ✅ | — | Mover-specific |
| Review request email (post-booking) | ✅ | — | Reusable |
| Pre-move tips email | ✅ | — | Mover-specific |
| Day-before tips email | ✅ | — | Mover-specific |

**Gap insight:** These are deep mover-specific features that don't apply to med spa MVP. **Skip them.** When we eventually port to verticals that have booking flows (med spa via Mindbody/Boulevard integrations), we revisit.

---

## N. Cron / Automated Workflows

| Cron | Boxly Pro | Reusable for Mapsly? | Notes |
|---|---|---|---|
| `weekly-snapshots` (Sun 10:00 UTC) | ✅ | ✅ Direct port | The whole time-series foundation |
| `competitor-alerts` (Mon 08:00 UTC) | ✅ | ✅ Direct port | Weekly delta email — proven retention loop |
| `ad-intelligence` (weekly) | ✅ | ✅ Direct port | DataForSEO Google Ads refresh |
| `serp-tracking` (Sun 12:00 UTC) | ✅ | ✅ Direct port | Per-keyword SERP positions |
| `pro-reresearch` (Sun 11:00 UTC) | ✅ | ✅ Direct port | Worker re-fetches reviews + business info |
| `quotes/expire` (hourly) | ✅ | Skip (mover-specific) | |
| `quotes/follow-up` (every 30m) | ✅ | Skip | |
| `tips/pre-move` (daily 07:00) | ✅ | Skip | |
| `tips/day-before` (daily 07:00) | ✅ | Skip | |
| `review-request` (daily 10:00) | ✅ | Reusable as cohort-based "ask for a review" | |
| `process-email-sequences` (every 15 min) | ✅ | ✅ Direct port — **the cold outreach engine** | |
| `research-blog-topics` (Sun 06:00) | ✅ | ✅ Direct port (SEO content pipeline) | |
| `generate-blog` (Mon–Fri 14:00, 18:00) | ✅ | ✅ Direct port | |
| `audit-published-blogs` (Sun 03:40) | ✅ | ✅ Direct port | |
| `answer-community-questions` (19:00) | ✅ | ✅ Direct port (Reddit Q&A engine) | |
| `submit-recovery-urls` (daily 02:30) | ✅ | ✅ Useful for new product launch SEO | |
| `translate-stale-fr` (Sun 05:30) | ✅ | Reusable later (FR market) | |

**Gap insight:** The cron engine is *significant* leverage. 12 of 17 reusable directly. The email-sequence cron is what powers cold outreach at scale — that one's the crown jewel for the new product.

---

## O. Pricing / Business Operations

| Feature | Boxly Pro | Landing | Notes |
|---|---|---|---|
| Stripe subscription tiers ($99/mo Pro, FEATURED) | ✅ | — | Proven; rename to $39/$89 tiers |
| `withBusinessAuth` ACL middleware | ✅ | — | Direct port |
| Admin bypass + tier gating | ✅ | — | |
| MoverAccess role-based access | ✅ | — | Rename to `BusinessAccess` |
| Cache tag conventions (per-business invalidation) | ✅ | — | Direct port with rename |

---

## P. Email Outreach Infrastructure

| Feature | Boxly Pro | Landing | Notes |
|---|---|---|---|
| `EmailCampaign` / `EmailSequence` / `EmailRecipient` / `EmailSend` schema | ✅ | — | Full cold outreach engine |
| Cohort filter system with `translateFilters` | ✅ | — | |
| Template engine with `applyTemplate` + 24 personalization tokens | ✅ | — | |
| Pre-flight QA endpoint (sample render before launch) | ✅ | — | |
| Zoho 4-account rotation | ✅ | — | Multi-tenant possible |
| DKIM / SPF / DMARC fully configured | ✅ | — | For boxly.ca; new domain needed for Mapsly |
| RFC 8058 one-click unsubscribe | ✅ | — | |
| Bot detection on open/click tracking | ✅ | — | |
| Daily caps + suppression list | ✅ | — | |
| Bounce handling (manual) | 🟡 | — | Could automate later |
| 15-min `process-email-sequences` cron | ✅ | — | |
| Admin UI at `/admin/email-campaigns` | ✅ | — | Full campaign management |

**Gap insight:** This is essentially a complete Instantly/Smartlead clone, custom-built. **You're sitting on a $200/mo SaaS replacement that you wrote yourself.** Reuse this on a new sending domain for Mapsly.

---

## Q. Public-side / Brand Assets

| Feature | Boxly Pro | Landing | Notes |
|---|---|---|---|
| Per-city marketplace page (lists all movers in city) | ✅ | 🌐 implied | "Top 10 in [City]" SEO play; reuses this pattern |
| Per-mover public profile | ✅ | — | Could be source of "claim your free dashboard" links |
| Community Q&A (public) | ✅ | — | Reusable as content moat |
| Blog automation pipeline | ✅ | — | Reusable |
| SEO Automation admin | ✅ | — | Reusable |

---

## What this means in practice

### Three categories of action

**A) Things we have, should show on landing (quick wins — surface what's built):**

| What to add to landing | Already-built source |
|---|---|
| Positive review themes ("your patients love…") | `MoverReviewTheme` (positive) |
| Top negative theme (1 line: "the pattern hurting you") | `MoverReviewTheme` (negative) |
| Projected score ("could be A− if you fix X") | `score/improvements` API |
| 12-month review trend mini-chart | `monthlyTrend` data |
| Weekly competitor alerts email teaser | `competitor-alerts` cron |
| AI ad copy generator hint | `ads/generate-copy` route |
| Backlink profile snapshot | DataForSEO Backlinks ($1/1k) |
| BBB rating + trust signals (where applicable) | `bbbRating`, `bbbAccredited` fields |
| "Top 20 movers stats" social proof ("X% of leaders do this") | `topMoversStats` in competitive-ranking route |
| 8-week history sparklines | `MoverWeeklySnapshot` |

**B) Things we show on landing, must actually build (close the trust gap):**

| What's on landing | What's needed |
|---|---|
| **Stolen Customer Index** — named patient matches with quotes | Profile-match logic (~2 weeks) |
| **Estimated revenue lost ($)** | Vertical avg-ticket lookup table |
| **Brand Hijack** (3 named bidders) | DataForSEO Google Ads query per business (~$0.0006 each) |
| **Empty slots / capacity** | Reframe as "search demand vs visibility" — we have that data |
| **Meta ads detection** | Meta Ad Library API wiring (~1 week, free) |
| **Competitor moves narrative** ("posted 14 GMB times") | Need to wire GMB Posts API |
| **Phone Test** | DROPPED — skip MVP |
| **Search demand keyword level** | Verify per-keyword visibility share math is real-time, not stale |

**C) Things we have but won't need for Mapsly MVP (skip):**

Quote system, booking flow, mover-specific pricing config, crew-size rates, piano/junk-removal service flags, mover-specific cron jobs (tips, follow-up). When we add verticals with similar booking surfaces (med spa via Mindbody), we revisit selectively.

---

## Translation: mover → med spa

Most of the engine ports cleanly. Vertical-specific translation needed for these fields:

| Mover concept | Med spa equivalent |
|---|---|
| Mover (entity name) | Business / Spa |
| Crew size 2 / crew size 3 rates | Treatment package prices (single / multi-session) |
| Price per lb (long distance) | Per-unit pricing (per syringe filler, per Botox unit) |
| Min hours required | Minimum service ticket |
| Has piano moving / commercial / storage / packing / junk | Has Botox / fillers / laser / microneedling / PRP |
| Estimated move date (lead signal) | Estimated treatment date |
| Booking flow (truck-based) | Booking flow (calendar appointment) |
| Quote generation (PDF) | Treatment package quote |
| Mover Reviews | Patient reviews (same data shape) |
| BBB rating | BBB rating + state cosmetology board |
| Subreddits: r/movers, r/RealEstate | Subreddits: r/30PlusSkinCare, r/SkincareAddiction, r/[city] |

The Boxly Score 6 dimensions all carry over with re-weighted importance:

| Dimension | Mover weight | Med spa weight |
|---|---|---|
| Reputation | 25% | 35% (reviews matter more) |
| Fair Prices | 20% | 10% (transparency less critical) |
| Reliability | 20% | 15% |
| Transparency | 15% | 15% |
| Communication | 12% | 20% (Instagram-driven) |
| Responsibility | 8% | 5% |

---

## Summary

We've built far more than we've shown. The MVP path is:

1. **Port the Boxly Pro engine to `Business` entity** — 1 week
2. **Add the 4 missing data sources** (Meta Ad Library, Wappalyzer, RDAP, Certificate Transparency) — all free, all ~1 week total
3. **Build the 5 high-value composite signals not yet computed:** Stolen Customer Index match logic, Reputation Drift, Brand Hijack query, Search Demand vs Visibility (already partial), Marketing Spend Wasting Index — ~2 weeks
4. **Drop or downgrade the 4 unsupported landing claims:** Phone Test (drop), Empty Slots (reframe), Specific dollar-impact estimates (caveat as "estimated"), Profile-match patient names (gate behind real algorithm)
5. **Add 5 already-built surfaces to the landing:** themes, projected score, weekly history, AI ad copy teaser, competitor-alert email opt-in

Total: ~4–6 weeks AI-assisted to have a v1 product that *delivers everything the landing page promises*.

Without this work, the landing page sets up expectations the product can't meet on Day 1. With it, you ship a product whose marketing page is conservative — and that converts.
