# Mapsly Signals Inventory · Technical Reference

Internal reference. Every signal we collect or compute, with data source, refresh frequency, and the formula behind it. Cross-referenced to product pages.

Last updated: 2026-05-18.

---

## A. Identity & Profile Data

| Signal | Source | Frequency | Formula / Logic | Page |
|---|---|---|---|---|
| Business name | DataForSEO Google Maps SERP (`business_data_business_listings_search`) | Weekly | Direct field: `title` | All pages (header) |
| Address | DataForSEO Google Maps SERP | Weekly | Direct field: `address` | Header · Settings |
| Phone | DataForSEO Google Maps SERP | Weekly | Direct field: `phone` | Header · Website Health (check: phone visible on page) |
| Website URL | DataForSEO Google Maps SERP | Weekly | Direct field: `url` | Header · Website Health |
| Hours (per day) | DataForSEO Google Maps SERP | Weekly | Direct: `work_time.work_hours.timetable` | Header · Competitors (vs you) |
| Categories | DataForSEO Google Maps SERP | Weekly | `category_ids[]` | Settings · Used to filter competitor census |
| Photos count (Google) | DataForSEO Google Maps SERP | Weekly | Direct: `total_photos` | Dashboard · Competitors |
| Instagram handle + followers | DataForSEO Google SERP organic (Instagram result snippet) | Weekly | Parse from organic SERP for `instagram.com/{handle}` | Dashboard · Competitors |
| Years on Google | DataForSEO Maps + lookup via `first_seen` field | Once + monthly check | `(now - first_seen).years` | Dashboard (trust signal) |
| Claimed on Google | DataForSEO Maps | Weekly | Direct: `is_claimed` | Settings · Dashboard alert if false |
| Coordinates (lat/lng) | DataForSEO Maps | Once + manual re-verify | Direct: `latitude`/`longitude` | Used for proximity competitor detection |
| Attributes (LGBTQ-welcoming, wheelchair, sauna, etc.) | DataForSEO Maps | Weekly | Direct: `attributes{}` | Settings · Competitors comparison |

---

## B. Review Intelligence

| Signal | Source | Frequency | Formula / Logic | Page |
|---|---|---|---|---|
| Current Google rating | DataForSEO Maps + SERP knowledge graph (cross-verified) | Weekly | Direct: `rating.value` | Dashboard · Reviews · Header |
| Current review count | DataForSEO Maps + SERP knowledge graph | Weekly | Direct: `rating.votes_count` | Dashboard · Reviews · Competitors |
| Rating distribution (1-5★ breakdown) | DataForSEO Maps (`rating_distribution`) | Weekly | Direct: `rating_distribution{}` | Reviews (visualization) |
| Recent reviews list (last 20) | DataForSEO Google Reviews API (`business_data/google/reviews`) | Weekly | sort_by=newest, depth=20 | Reviews (main list) |
| Per-review fields (rating, text, date, owner reply flag) | DataForSEO Reviews API | Weekly | Direct: `items[].review_rating`, `text`, `time_iso`, `owner_answer` | Reviews (per row) |
| Reviewer name anonymization | Internal post-processing | Weekly | First-initial + last-initial of `profile_name` | Reviews (privacy) |
| Owner reply rate | Computed from Reviews API | Weekly | `count(items.owner_answer !== null) / count(items)` over last 20 | Dashboard · Reviews (KPI tile) |
| Unanswered reviews count | Computed from Reviews API | Weekly | `count(items where owner_answer == null)` | Dashboard alert · Reviews queue |
| Review velocity (per week / month) | Computed from Reviews API time series | Weekly | `count(reviews in last 7d)` / `count in last 30d` | Dashboard · Competitors comparison |
| Velocity vs leader | Computed | Weekly | `(your_velocity / leader_velocity)` ratio | Dashboard (delta tile) |
| AI-extracted top mentioned topics | DataForSEO `place_topics` (Google's own theme extraction) | Weekly | Direct: `place_topics[]` with `mentions` counts | Reviews · Competitors |
| AI sentiment per review | LLM classification (Haiku) | On every new review | Prompt: classify as positive/neutral/negative + extract issue tag | Reviews (sentiment column) |
| AI-drafted reply per unanswered review | LLM generation (Haiku/Sonnet) | On every new unanswered review | Prompt with context: business name, review text, tone guide, length 80–140 words | Reviews (Reply panel) |
| Reply tone selector | User-configurable | n/a | Stored config: professional / warm / brief / detailed | Reviews settings |
| Bilingual reply detection | LLM + language detect | On every new review | If review language != English, generate reply in same language | Reviews |
| Returning-customer flag | Heuristic from `profile_reviews_count` | Weekly | `profile_reviews_count > 5` AND has previous review of same business | Reviews |

---

## C. Competitor Tracking

| Signal | Source | Frequency | Formula / Logic | Page |
|---|---|---|---|---|
| Top N competitors (local pack) | DataForSEO SERP organic for "{category} {city}" | Weekly | First 3 in `local_pack` + next 6 from `people_also_search` | Competitors |
| Per-competitor: rating, review count, photos | DataForSEO Maps per competitor `place_id` | Weekly | Direct fields | Competitors |
| Per-competitor: hours, attributes, address | DataForSEO Maps | Weekly | Direct fields | Competitors (comparison) |
| Rating gap vs you | Computed | Weekly | `competitor.rating - your.rating` | Competitors (column) |
| Review count gap | Computed | Weekly | `competitor.review_count - your.review_count` | Competitors |
| Review velocity gap | Computed | Weekly | `competitor.velocity - your.velocity` | Competitors · Dashboard |
| Photo count gap | Computed | Weekly | `competitor.photos - your.photos` | Competitors |
| Same-building / proximity flag | Geocode distance from competitor `lat/lng` | Weekly | Same address AND `distance < 50m` ⇒ "in your building" flag | Dashboard alert · Competitors |
| Competitor weekly activity feed | DataForSEO Maps + Reviews diff between snapshots | Weekly | New reviews · new photos · GMB post diffs · hours change | Dashboard · Activity feed |
| Competitor themes (what their patients praise) | DataForSEO `place_topics` per competitor | Weekly | Direct: `place_topics[]` | Competitors (deep-dive page) |
| Competitor staff names mentioned | LLM extraction from competitor reviews | Weekly | Prompt: extract first names of staff from review text, count mentions | Competitors deep dive |
| Competitor's first_seen_on_google | DataForSEO Maps `first_seen` | Once + monthly | Direct field | Used to compute "they passed you in X months" |

---

## D. Search & Visibility

| Signal | Source | Frequency | Formula / Logic | Page |
|---|---|---|---|---|
| Keyword search volume | DataForSEO Google Ads Keyword Volume API | Monthly | Direct: `search_volume` per keyword in location | Search · Dashboard |
| Keyword CPC | DataForSEO Google Ads | Monthly | Direct: `cpc` | Search (sortable) |
| Keyword competition score | DataForSEO Google Ads | Monthly | Direct: `competition` + `competition_index` | Search |
| 12-month trend per keyword | DataForSEO Google Ads | Monthly | `monthly_searches[]` array — line chart | Search |
| Your local pack rank per keyword | DataForSEO SERP organic live | Weekly | Find your `place_id` in `local_pack[]` array | Search · Dashboard |
| Local pack occupants (top 3) | DataForSEO SERP organic | Weekly | First 3 items in `local_pack` | Search per-keyword view |
| Your organic rank per keyword | DataForSEO SERP organic live | Weekly | Find your domain in `organic[]` array | Search |
| Service catalog × demand match | Internal join | Weekly | For each service you offer, look up its search volume + your rank | Search (matrix view) |
| Open lane detection | Computed | Weekly | Keywords where `competition_advertisers <= 2` AND `you_offer = true` AND `your_rank = none` | Search highlight · Dashboard |
| Share of voice estimate | Computed | Weekly | `CTR_by_rank[your_rank] × volume` for each keyword you appear in | Search summary tile |
| Service catalog source | Combined: Google Maps `category_ids[]` + website crawl + review topic mentions ≥5× | Weekly | Union of three sources, deduped | Search · Settings (editable) |
| Trending services in market | Aggregated keyword growth | Monthly | Top 5 keywords with YoY growth > 50% in your metro | Search (highlight) |

---

## E. Ads Intelligence

| Signal | Source | Frequency | Formula / Logic | Page |
|---|---|---|---|---|
| Your active Meta ads | Meta Ad Library API (free) | Daily | Search `search_terms = your_business_name` + `ad_active_status = ACTIVE` | Ads (your ads tab) |
| Your active Google ads | Google Ads Transparency Center (via Chrome MCP) | Daily | Search by domain `soleabrickellspa.com` · filter Last 30 days | Ads (your ads tab) |
| Your ad copy themes (auto-cluster) | LLM clustering on your ad creatives | Weekly | Group by similar copy: "$59 deal", "skin tightening", etc. | Ads (your ads section) |
| Your ad landing pages | Meta Ad Library field `landing_url` | Weekly | Direct field | Ads (your ads — landing review) |
| Per-keyword competitor advertiser count | Meta Ad Library | Weekly | For each keyword: `search_terms = keyword`, count unique `page_id` over 30d | Ads (Meta tab) |
| Per-keyword top advertisers | Meta Ad Library | Weekly | Group ads by `page_id`, sort by `ad_count` desc | Ads (Meta tab) |
| Competitor ad copy samples | Meta Ad Library | Weekly | Top advertiser's `ad_creative_body` snippet | Ads (Meta tab drill-down) |
| Brand hijack detection | DataForSEO SERP for `query = your_business_name` | Daily | Inspect `items[]` for `type = paid` | Dashboard alert · Ads (brand hijack) |
| Brand hijack bidder list | DataForSEO SERP paid items | Daily | `items where type=paid` → `advertiser_domain` + `headline` + estimated bid | Ads (brand hijack tab) |
| Google Ads competitor lifetime + 30d count | Google Ads Transparency Center | Weekly | Domain lookup → `lifetime_ad_count`, `last_30d_count` | Ads (Google tab) |
| Open-lane Meta opportunities | Computed | Weekly | Service keywords where `you offer = true` AND `Meta advertiser count ≤ 2` | Ads (recommendations tab) |
| Estimated CPC ceiling per keyword | DataForSEO Google Ads | Monthly | Direct: `high_top_of_page_bid` | Ads (recommendations · cost projection) |

---

## F. Website Health

| Signal | Source | Frequency | Formula / Logic | Page |
|---|---|---|---|---|
| Lighthouse Performance score | DataForSEO On-Page Lighthouse | Weekly | Direct: `categories.performance.score × 100` | Website Health (main score) |
| Lighthouse Accessibility | DataForSEO Lighthouse | Weekly | Direct: `categories.accessibility.score × 100` | Website Health |
| Lighthouse Best Practices | DataForSEO Lighthouse | Weekly | Direct: `categories.best-practices.score × 100` | Website Health |
| Lighthouse SEO | DataForSEO Lighthouse | Weekly | Direct: `categories.seo.score × 100` | Website Health |
| FCP (First Contentful Paint) | DataForSEO Lighthouse | Weekly | Direct: `audits.first-contentful-paint.numericValue` (ms) | Website Health |
| LCP (Largest Contentful Paint) | DataForSEO Lighthouse | Weekly | Direct: `audits.largest-contentful-paint.numericValue` | Website Health |
| TBT (Total Blocking Time) | DataForSEO Lighthouse | Weekly | Direct: `audits.total-blocking-time.numericValue` | Website Health |
| CLS (Cumulative Layout Shift) | DataForSEO Lighthouse | Weekly | Direct: `audits.cumulative-layout-shift.numericValue` | Website Health |
| Server response (TTFB) | DataForSEO Lighthouse | Weekly | Direct: `audits.server-response-time.numericValue` | Website Health |
| Total page bytes | DataForSEO Lighthouse | Weekly | Direct: `audits.total-byte-weight.numericValue` | Website Health |
| Mobile-friendly check | DataForSEO Lighthouse mobile-formFactor | Weekly | Pass if Performance > 50 AND `viewport-meta` audit passes | Website Health |
| Tech stack detection | Wappalyzer self-hosted (open source) | Monthly | Parse HTML + headers for known signatures | Website Health (footer) |
| Third-party scripts list | DataForSEO Lighthouse `third-party-summary` audit | Weekly | Direct: `audits.third-party-summary.details.items[]` | Website Health (advanced) |
| Phone visible on first scroll | Mapsly custom DOM check | Weekly | Crawl homepage, check `<a href="tel:...">` exists in first 800px | Website Health (12-check audit) |
| Pricing on a public page | Mapsly custom DOM check + LLM | Weekly | Crawl site, LLM-classify pages by intent, check if any page has price tokens (e.g., `$\d+`) | Website Health |
| Schema markup (LocalBusiness) | Schema.org validator | Weekly | Parse JSON-LD, check `@type = LocalBusiness` exists | Website Health |
| Booking CTA above the fold | Mapsly DOM check | Weekly | Crawl homepage, check `<a>` with text matching `book\|appointment\|schedule` in first 600px | Website Health |
| Embedded Google Map | Mapsly DOM check | Weekly | Find `<iframe src*="google.com/maps">` on contact page | Website Health |
| Reviews on homepage | Mapsly DOM check | Weekly | Look for review widget markers (g.co/kgs, embed snippets, schema markup) | Website Health |
| Industry baseline (median + p95) | Computed | Monthly | Run Lighthouse on top 10 competitor sites, compute median + p95 of Performance score | Website Health (comparison) |

---

## G. Market / Census Data

| Signal | Source | Frequency | Formula / Logic | Page |
|---|---|---|---|---|
| Total active competitors in metro | DataForSEO Maps business search by category | Monthly | `categories=['medical_spa']` + 12km radius → count `items` | Dashboard · Market reality |
| Total claimed competitors | Computed | Monthly | Filter above by `is_claimed = true` | Market reality |
| Your rank by review count | Computed | Weekly | Sort all competitors by `review_count` desc, find your position | Dashboard · Market reality |
| Your rank by rating | Computed | Weekly | Sort by `rating` (ties broken by review count), find your position | Dashboard |
| Market median review count | Computed | Weekly | Median of `review_count` across top 40 competitors | Market reality |
| Market average rating | Computed | Weekly | Mean of `rating` across competitors | Market reality |
| Rating distribution (market) | Computed | Weekly | Histogram of competitor ratings | Market reality |
| % of competitors running ads | Meta Ad Library batch | Weekly | For each competitor in census, check if any active Meta ads → `(with_ads / total)` | Market reality |
| Your effective MSI rank | Computed (Market Share Index) | Weekly | Weighted: 30% reviews + 20% rating + 20% completeness + 15% response + 10% Boxly + 5% pricing | Header (#37 of 40) |
| Trending services in market | Aggregated keyword growth | Monthly | Top 5 keywords with YoY > 50% in metro | Market reality |
| Spas added in last 30 days | DataForSEO Maps `first_seen` diff | Monthly | Count competitors with `first_seen` < 30 days | Market reality (alert) |

---

## H. Computed / Derived Scores

| Signal | Source | Frequency | Formula / Logic | Page |
|---|---|---|---|---|
| Mapsly Score (0–10) | Internal composite | Weekly | Weighted sum of 6 dimensions normalized 0–10 | Dashboard (main KPI) |
| Reputation sub-score | Internal | Weekly | `(rating/5 × 0.5) + (log(reviews+1)/log(market_max+1) × 0.5)` → ×10 | Dashboard breakdown |
| Communication sub-score | Internal | Weekly | `owner_reply_rate × 10` | Dashboard breakdown |
| Profile completeness | Internal | Weekly | `count(filled_fields) / count(total_fields)` × 10 (8 fields tracked) | Dashboard breakdown |
| Trust signals score | Internal | Weekly | Count of: insurance verified, claimed, years > 2, BBB profile, attributes → ×10 | Dashboard breakdown |
| Pricing transparency score | Internal | Weekly | Score from: prices on website (3pt) + Google pricing attribute (2pt) + review price mentions positive (5pt) | Dashboard |
| Brand presence score | Internal | Weekly | Photos count percentile + Instagram followers percentile + GMB post frequency | Dashboard |
| Projected score with fixes | Internal | Weekly | Apply impact estimates from `recommendedFixes` to current sub-scores | Dashboard "where you could be" |
| Recommended fixes (algorithm-triggered) | Internal rules engine | Weekly | Set of rules: "if owner_reply_rate < 30% → recommend reply", etc. Each rule outputs fix + trigger logic + impact estimate | Dashboard · Diagnostic block |
| Estimated new patients/month | Internal | Weekly | `Σ(keyword_volume × CTR[your_rank] × industry_conversion_rate)` across keywords you appear in | Dashboard (outcome KPI) |
| Estimated revenue lift per fix | Internal | Weekly | Per-fix marginal contribution to estimated patients × avg ticket | Diagnostic block (impact column) |

---

## I. Notifications & Alerts

Generated by internal monitoring rules, surfaced as Activity feed + email/push.

| Alert | Trigger | Source | Frequency | Page |
|---|---|---|---|---|
| New 1★ review | New review with rating = 1 | Reviews API diff | Within 24h | Dashboard alert · Reviews queue |
| Brand hijack detected | Paid ad appears for your brand SERP | DataForSEO SERP daily | Daily | Dashboard alert · Ads |
| Competitor passes you in reviews | Competitor `review_count` crosses yours | Reviews diff | Weekly | Dashboard alert |
| New competitor in your local pack | New entrant in local pack for primary keyword | SERP weekly | Weekly | Dashboard alert |
| Ranking drop ≥ 3 positions | Your rank drops 3+ on any tracked keyword | SERP weekly | Weekly | Dashboard alert · Search |
| Site speed degraded ≥ 10 points | Lighthouse score drops ≥ 10pt vs last week | Lighthouse weekly | Weekly | Website Health alert |
| New competitor ad campaign | Competitor launches new Meta or Google ad | Ad Libraries daily | Daily | Activity feed · Ads |
| Theme spike (positive) | New theme appears in your reviews ≥ 3× in a week | Reviews + place_topics | Weekly | Activity feed |
| Theme spike (negative) | New negative theme appears in your reviews ≥ 2× | Reviews + sentiment | Weekly | Activity feed |
| Hours change at competitor | Competitor's hours field changes | Maps diff | Weekly | Activity feed |

---

## J. Data Source Cost Reference

Per business, per refresh cycle:

| Source | Per-business cost | Notes |
|---|---|---|
| DataForSEO Maps SERP (basic) | $0.0006 | Standard queue |
| DataForSEO Reviews API (20 reviews) | $0.003 | Per task |
| DataForSEO SERP organic live | $0.003 | Per keyword |
| DataForSEO Keyword Volume | $0.001 | Per keyword |
| DataForSEO Lighthouse | $0.003 | Per audit |
| Meta Ad Library API | $0 | Free |
| Google Ads Transparency | $0 | Free, scraped |
| Mapsly DOM checks (self-host) | $0 | Server time only |
| LLM (Haiku) review sentiment + reply draft | $0.001 | Per review |
| Wappalyzer (self-host) | $0 | One-time |

**Per-business weekly refresh cost (full feature set):** ~$0.05–$0.12
**At 1,000 active customers:** ~$60–$120/week DataForSEO + AI

---

## K. Refresh Cadence Summary

| Cadence | What runs |
|---|---|
| **Daily** | Brand hijack check · Ad inventories diff (new ads alert) · New review alerts |
| **Weekly (cron: Sunday night)** | Full Maps refresh · Reviews pull (last 20) · SERP per tracked keyword · Lighthouse audit · Competitor activity diff · MSI recomputation · Score recomputation · Recommended fix engine rerun |
| **Monthly** | Keyword volume refresh · Market census (full category sweep) · Industry baseline recompute · Trending services analysis |
| **On signup + on-demand** | Initial profile pull · Lighthouse for new competitor · Service catalog reconciliation |
| **Real-time (within 1h)** | New review notification · Significant rank shift alert · New competitor ad alert |

---

## L. Coverage Matrix · which page surfaces which signal

| Page | Signals shown |
|---|---|
| **Dashboard (Home)** | Mapsly Score · MSI rank · Today's alerts · Review velocity · Unanswered reviews count · Top 3 fixes · Patients-per-month estimate · This week's competitor moves |
| **Reviews** | Recent reviews list (20) · Unanswered queue · AI-drafted replies · Themes · Rating trend · Sentiment per review · Bilingual replies · Reviewer profile · Reply tone settings |
| **Competitors** | Top 6 competitors · Per-competitor stats · Rating + review + photo gaps · Same-building proximity · Themes per competitor · Staff name extraction · "When they passed you" |
| **Search & Visibility** | 14 keyword matrix · Your rank per keyword · Local pack occupants · Open lanes · Trending services · Volume + CPC + competition · Service × demand match · Share of voice estimate |
| **Ads Intelligence** | Your active Meta/Google ads · Your ad themes · Per-keyword competitor advertiser count · Brand hijack alerts · Open lane recommendations · Competitor ad copy samples |
| **Website Health** | Lighthouse scores (Performance/A11y/BP/SEO) · 12-parameter audit · Industry baseline · Tech stack · Booking CTA / phone / pricing / schema checks |
| **Market Reality** | Total competitors in metro · MSI rank · Median + p95 stats · Rating distribution · % running ads · Trending services · New entrants alert |
| **Activity Feed** | All alerts (daily + weekly) · Filterable by type · Mark-as-read · Snooze · Settings |
| **Settings** | Business profile editable · Notification preferences · Reply tone presets · Billing · Team members · Data sources status |

---

## M. Signals NOT yet collected · roadmap

These would extend the product significantly. Listed for future:

| Signal | Why valuable | Source needed | When |
|---|---|---|---|
| GMB Posts diff (new posts by competitors) | Track competitor content cadence | GMB API or scrape | Phase 2 |
| Yelp reviews + rating | 2nd-largest review platform | Yelp Fusion API | Phase 2 |
| Instagram post engagement (likes, comments) | Real social health signal | Instagram Graph API + opt-in | Phase 3 |
| TikTok ads | Growing channel for local | TikTok Creative Center | Phase 3 |
| Booking system usage | Detect what booking platform competitor uses | Tech stack detection | Phase 2 |
| Quote-response time (actual measurement) | Real Secret Shopper from opt-in | Internal opt-in service | Phase 4 |
| Phone answer-time (actual call) | Real call performance | Opt-in CallRail integration | Phase 4 |
| Real revenue attribution | Tie reviews/ads/rank to actual bookings | Integration with Mindbody, Boulevard, Vagaro | Phase 3 |
| Email-marketing engagement (yours) | Connect to existing email tool | Mailchimp / Klaviyo API | Phase 3 |
| Reddit mentions of your brand | Track word-of-mouth | Apify Reddit scraper | Phase 2 |
| News mentions | Press monitoring | NewsAPI · Google News RSS | Phase 2 |

---

*Document version 1.0 · use as the single source of truth for "where does this number come from" and "how often does it update" when building product pages.*
