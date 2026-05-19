# Data collection cadence + cost

The product economics depend on collecting the right data at the right frequency. This doc is the single source of truth for **what we collect, how often, and what it costs**. All cron job definitions in `vercel.json` reference these cadences.

## Principles

1. **Daily** = signal-volatile data (ads, brand hijack, new reviews). Cheap APIs only.
2. **Weekly** = anchor pull (profile, Lighthouse, SERP, MSI recompute). Largest cost block.
3. **Monthly** = slow-moving data (keyword volume, market census, industry baselines).
4. **On-demand** = expensive operations the user triggers (re-audit, generate one-pager).
5. **Never re-pull** within the cadence window unless the user explicitly requests.

## What runs and when

### Daily · 6:00 AM user-local time per business
| Job | What it does | Cost / business | Source |
|---|---|---|---|
| `daily/brand-hijack-scan` | Live Google SERP for the brand name, detect paid ads | $0.003 | DataForSEO SERP live |
| `daily/ad-library-diff` | Diff today's Meta Ad Library entries vs yesterday for tracked competitors + keyword lanes | $0 (free) | Meta Ad Library API |
| `daily/google-ads-transparency-scan` | Scan Google Ads Transparency for tracked competitor domains | $0 (free) | Google Ads Transparency Center |
| `daily/new-reviews-delta` | Compare review-count of tracked businesses vs yesterday; pull new ones via Reviews API | $0.003 per business with delta | DataForSEO Reviews API |
| `daily/list-refresh-daily` | Re-evaluate filters on daily-cadence agency lists, add/remove leads | $0 (DB-only) | Internal |
| `daily/indexer-new-businesses` | Pull category census in tracked metros, diff vs yesterday, add new businesses to index | ~$0.002 per metro × category | DataForSEO Maps category |

**Daily total per active SMB/Pro business: ~$0.006–0.012/day.**
**At 1,000 SMB clients: ~$6–12/day total = ~$200–360/mo.**

### Weekly · Monday 06:00 AM user-local time per business
| Job | What it does | Cost / business | Source |
|---|---|---|---|
| `weekly/business-profile-refresh` | Full Maps SERP pull — rating, reviews, photos, hours, attributes | $0.0006 | DataForSEO Maps SERP |
| `weekly/reviews-full-pull` | Last 20 reviews + theme topics | $0.003 | DataForSEO Reviews API |
| `weekly/sentiment-classify` | AI sentiment + theme tags per new review | $0.001 per review · ~6 reviews/wk avg | Claude Haiku |
| `weekly/ai-reply-draft` | Draft EN/ES replies for unanswered urgent reviews | $0.002 per draft · ~2/wk avg | Claude Haiku |
| `weekly/serp-rank-scan` | For each of N tracked keywords, scan local pack + organic | $0.003 × ~14 keywords = $0.042 | DataForSEO SERP organic |
| `weekly/lighthouse-audit` | Mobile Lighthouse audit + 5 custom DOM checks | $0.003 | DataForSEO Lighthouse |
| `weekly/competitor-diff` | Per-competitor stats diff vs last week (rating, reviews, photos, hours change) | $0.0006 × ~5 competitors = $0.003 | DataForSEO Maps |
| `weekly/snapshot-write` | Compute Mapsly Score, MSI rank, score breakdown, write BusinessSnapshot | $0 (DB-only) | Internal |
| `weekly/recommended-fixes` | Rules engine: pick top-3 fixes for the dashboard | $0 (DB-only) | Internal |
| `weekly/list-refresh-weekly` | Re-evaluate filters on weekly-cadence agency lists | $0 (DB-only) | Internal |

**Weekly total per business: ~$0.06.**
**At 1,000 SMB clients: ~$60/wk = ~$260/mo.**

### Monthly · 1st of month 02:00 AM
| Job | What it does | Cost | Source |
|---|---|---|---|
| `monthly/keyword-volume-refresh` | Refresh search volume + CPC for every tracked keyword in DB | $0.001 × keywords | DataForSEO Keyword Volume |
| `monthly/market-census` | Full Maps category sweep per active metro/category to catch new entrants | $0.002 × metro × category | DataForSEO Maps |
| `monthly/industry-baseline` | Re-compute median Lighthouse scores across top 10 competitors per category | $0.003 × ~50 audits | DataForSEO Lighthouse |
| `monthly/inactive-cleanup` | Mark businesses as inactive if `is_active=false` from Maps for 3 consecutive months | $0 | DB-only |
| `monthly/email-verification-resweep` | Re-verify all stored emails (SMTP check) | $0.0005 per email | SMTP verify service |

**Monthly total: ~$50–100/mo on the agency side · less for SMB.**

### On-demand · user-triggered
| Action | Cost | Source |
|---|---|---|
| Re-run weekly snapshot now | $0.06 (same as weekly) | Same as weekly |
| Re-audit a single Lighthouse | $0.003 | DataForSEO Lighthouse |
| Generate one-pager PDF | $0.005 (Haiku for copy generation) | Claude Haiku + headless PDF |
| Generate shareable link | $0 (templated) | Internal |
| CSV export | $0 | Internal |
| Manual prospect lookup (global biz search) | $0.0006 if not in index | DataForSEO Maps |

## Cost budgets per tier

| Tier | Monthly retail | Daily ceiling | Weekly ceiling | Monthly ceiling | Margin target |
|---|---|---|---|---|---|
| SMB Free | $0 | $0.001 | $0.005 | $0.03 | (loss-leader) |
| SMB Paid · $29 | $29 | $0.01 | $0.07 | $1.50 | 95% |
| Agency Solo · $49 | $49 | $0.10 (1 list × 200 leads) | $0.50 | $5 | 90% |
| Agency Growth · $99 | $99 | $0.30 (10 lists, daily refresh) | $1.50 | $15 | 85% |
| Agency Pro · $249 | $249 | $1.00 | $5 | $40 | 84% |
| Boutique · $499 | $499 | $2.50 | $12 | $100 | 80% |

If a customer ever approaches their tier's ceiling we throttle (downgrade their refresh from daily to weekly) before failing — never silently overspend.

## Hard rules

1. **Never run a costly job ad-hoc without a CronRun record.** Every API call is logged with cost so we can audit.
2. **Cache aggressively.** Lighthouse for the same URL within 24h returns cached.
3. **Batch where possible.** Keyword volume + SERP both support batch endpoints — use them.
4. **No live calls in user request path.** Everything user-facing reads from `BusinessSnapshot`, `Review`, `LighthouseAudit`. Live calls happen in cron jobs only.
5. **DataForSEO Standard queue, not Live.** Standard is 10× cheaper. Live is reserved for brand-hijack daily scan (latency-critical).

## How this is enforced in code

- `vercel.json` declares all cron paths with cron expressions.
- Each cron handler at `app/api/cron/{job}` opens a `CronRun`, calls the relevant `services/{vendor}` adapter, writes results, closes the `CronRun` with cost + status.
- `services/{vendor}` adapters wrap every API call in a cost-counter that increments the open `CronRun.costUsd`.
- Live-API calls during user request path throw — caught by middleware in `lib/middleware/no-live-api.ts`.
