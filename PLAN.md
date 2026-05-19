# Mapsly · PLAN.md

The build roadmap. Source of truth for **what to build next**. Read by `autonomous-build-loop` skill and by Viktor.

Status values: `pending` · `in_progress` · `blocked` · `completed`
Effort values: `S` (≤ 1h) · `M` (1–3h) · `L` (3–8h) · `XL` (8h+, needs human)
Tags: `human-required` means autonomous mode must skip; `signals` involves new signal logic; `db-migration` involves schema change.

---

## Phase 0 · Foundations (scaffold day — done)

| ID | Task | Effort | Status | Deps |
|---|---|---|---|---|
| 0.1 | Initialize Next.js 16 + Prisma 7 + Tailwind 4 + NextAuth scaffolding | M | completed | — |
| 0.2 | Prisma schema for full data model (Business, Snapshot, Review, Lighthouse, AdLib, SERP, Keyword, List, Lead, Agency, etc.) | M | completed | 0.1 |
| 0.3 | docs/data-cadence.md — what runs daily/weekly/monthly + cost ceiling per tier | M | completed | — |
| 0.4 | .env.example with all integrations | S | completed | — |
| 0.5 | .mcp.example.json with all MCPs (rename to .mcp.json post-clone) | S | completed | — |
| 0.6 | CLAUDE.md + .claude/rules + .claude/agents + .claude/skills (in _claude-setup/ — move post-clone) | L | completed | — |
| 0.7 | vercel.json with cron schedule for all 17 jobs | S | completed | — |

---

## Phase 1 · Get the app booting (week 1)

Goal: `pnpm dev` runs, magic-link signin works, an empty SMB and Agency dashboard render.

| ID | Task | Effort | Status | Deps | Tags |
|---|---|---|---|---|---|
| 1.1 | `pnpm install` runs clean; `pnpm typecheck` passes on empty modules | S | pending | 0.1 | |
| 1.2 | Set up Neon DB + run `prisma db push` to create initial schema | S | pending | 0.2 | human-required |
| 1.3 | Wire NextAuth v5 (Resend magic link) + sign-in pages (`/signin`, `/signin/check-email`) | M | pending | 1.2 | |
| 1.4 | Resend email template for magic links + onboarding welcome | S | pending | 1.3 | |
| 1.5 | Empty SMB dashboard scaffold at `/(smb)/dashboard` — pulls latest BusinessSnapshot, renders 6 KPI tiles | M | pending | 1.3, 0.2 | |
| 1.6 | Empty Agency lists scaffold at `/(agency)/lists` — pulls Agency.lists, renders cards | M | pending | 1.3, 0.2 | |
| 1.7 | Marketing landing migrated from `_design/landing/index.html` to `/(marketing)/page.tsx` | M | pending | 1.1 | |
| 1.8 | For-agencies marketing migrated from `_design/landing/for-agencies.html` to `/(marketing)/for-agencies/page.tsx` | M | pending | 1.1 | |
| 1.9 | Deploy to Vercel preview · validate end-to-end on real domain | S | pending | 1.5, 1.6, 1.7 | human-required |
| 1.10.1 | Subdomain routing · middleware.ts dev rewrite + Vercel domain config | S | pending | 1.1 | dashboard |
| 1.10.2 | `app/(dev)/dev/page.tsx` · layout + hero tiles + section grid with mock data | M | pending | 1.10.1 | dashboard |
| 1.10.3 | Real data sources · parse PLAN.md, session JSON, GitHub API, CronRun | M | pending | 1.10.2 | dashboard |
| 1.10.4 | Auto-refresh via revalidateTag + router.refresh() every 15s | S | pending | 1.10.3 | dashboard |
| 1.10.5 | MCP health ping + KV-backed cache | S | pending | 1.10.3 | dashboard |
| 1.10.6 | Auto-enhance signals · render from enhance-signals.json | S | pending | 1.10.3 | dashboard |
| 1.10.7 | process-enhancer agent · daily scheduled task · writes signals · opens PRs | M | pending | 1.10.6 | dashboard, self-improvement |

---

## Phase 2 · External services + cost discipline (week 2)

Goal: every external API has a working `services/{vendor}` adapter with cost tracking.

| ID | Task | Effort | Status | Deps | Tags |
|---|---|---|---|---|---|
| 2.1 | `lib/cost/cost-counter.ts` — AsyncLocalStorage wrapper, increments open CronRun | M | pending | 0.2 | |
| 2.2 | `lib/cache/index.ts` — 24h cache helper backed by Vercel KV (cron + adapter use) | M | pending | 2.1 | |
| 2.3 | `services/dataforseo/` — Maps, Reviews, SERP organic, Local pack, Keyword Volume, Lighthouse adapters | L | pending | 2.1, 2.2 | |
| 2.4 | `services/meta-ad-library/` — daily ad scan adapter | M | pending | 2.1, 2.2 | |
| 2.5 | `services/lighthouse/` — wraps DataForSEO Lighthouse + custom DOM checks (schema, NAP, booking CTA) | M | pending | 2.3 | |
| 2.6 | `services/email-verify/` — SMTP verification | S | pending | 2.1 | |
| 2.7 | `services/ai-haiku/` — Anthropic SDK wrapper for sentiment + reply drafts | M | pending | 2.1 | |
| 2.8 | `services/stripe/` — checkout session, subscription state, webhook handlers | L | pending | 2.1 | |

---

## Phase 3 · Cron pipeline (week 3)

Goal: 17 cron jobs run on schedule, data lands in DB, CronRun rows audit cost.

| ID | Task | Effort | Status | Deps | Tags |
|---|---|---|---|---|---|
| 3.1 | Daily — `/api/cron/daily/brand-hijack-scan` | M | pending | 2.3 | |
| 3.2 | Daily — `/api/cron/daily/ad-library-diff` | M | pending | 2.4 | |
| 3.3 | Daily — `/api/cron/daily/new-reviews-delta` | M | pending | 2.3 | |
| 3.4 | Daily — `/api/cron/daily/indexer-new-businesses` | M | pending | 2.3 | |
| 3.5 | Daily — `/api/cron/daily/list-refresh-daily` | M | pending | 0.2 | |
| 3.6 | Daily — `/api/cron/daily/google-ads-transparency` | M | pending | 2.4 | |
| 3.7 | Weekly — `/api/cron/weekly/business-profile-refresh` | M | pending | 2.3 | |
| 3.8 | Weekly — `/api/cron/weekly/reviews-full-pull` + sentiment classify + AI reply drafts | L | pending | 2.3, 2.7 | |
| 3.9 | Weekly — `/api/cron/weekly/serp-rank-scan` | M | pending | 2.3 | |
| 3.10 | Weekly — `/api/cron/weekly/lighthouse-audit` | M | pending | 2.5 | |
| 3.11 | Weekly — `/api/cron/weekly/competitor-diff` | M | pending | 2.3 | |
| 3.12 | Weekly — `/api/cron/weekly/snapshot-write` (Mapsly Score + MSI compute) | L | pending | 3.7–3.11 | signals |
| 3.13 | Weekly — `/api/cron/weekly/list-refresh-weekly` | M | pending | 0.2 | |
| 3.14 | Monthly — `/api/cron/monthly/keyword-volume-refresh` | M | pending | 2.3 | |
| 3.15 | Monthly — `/api/cron/monthly/market-census` | L | pending | 2.3 | |
| 3.16 | Monthly — `/api/cron/monthly/industry-baseline` | M | pending | 2.3, 2.5 | |
| 3.17 | Monthly — `/api/cron/monthly/email-verification` | S | pending | 2.6 | |

---

## Phase 4 · Signal vocabulary + Hunter UI (week 4)

Goal: the 60+ signals work end-to-end. Agency Hunter can tune values, save lists.

| ID | Task | Effort | Status | Deps | Tags |
|---|---|---|---|---|---|
| 4.1 | `modules/signals/registry.ts` — canonical filter definitions for all 60+ signals | L | pending | 3.12 | signals |
| 4.2 | `modules/scoring/` — Mapsly Score formula, MSI rank, match score | L | pending | 4.1 | signals |
| 4.3 | `modules/hunter/groups.ts` — the 8 filter categories with editable rows | M | pending | 4.1 | |
| 4.4 | Hunter UI at `/(agency)/search` — filter rows, comparator + value, live count, save-as-list modal | L | pending | 4.3 | |
| 4.5 | Save-list modal → creates List row → triggers initial list-refresh | M | pending | 4.4 | |
| 4.6 | Lists page at `/(agency)/lists` — render real lists, hover-clone, "today's new matches" strip | M | pending | 4.5 | |
| 4.7 | List detail at `/(agency)/lists/[id]` — filter row, status tabs, lead rows, bulk-action bar | L | pending | 4.6 | |
| 4.8 | Lead status state machine: NEW → CONTACTED → REPLIED → WON/LOST, manual override | M | pending | 4.7 | |
| 4.9 | Service templates (8 quick-start bundles) + cross-link from lists | S | pending | 4.4 | |
| 4.10 | Global business search bar in topbar (`⌘K`) — looks up by name/URL | M | pending | 2.3 | |

---

## Phase 5 · Prospect detail + reports (week 5)

Goal: agency can deeply research a single business and generate a pitch artifact.

| ID | Task | Effort | Status | Deps | Tags |
|---|---|---|---|---|---|
| 5.1 | Prospect view at `/(agency)/prospect/[businessId]` — hero, top stats, 4 pitch wedges, signal blocks | L | pending | 4.1, 4.2 | |
| 5.2 | "Mark as client" button → adds to agency's client registry → excluded from future lists | S | pending | 5.1 | |
| 5.3 | One-pager PDF generation — render Solea-style template with real business data, write to Vercel Blob | L | pending | 5.1 | |
| 5.4 | CSV export — column picker, write to Vercel Blob | M | pending | 4.7 | |
| 5.5 | Shareable link — public route at `/share/[publicShareId]`, view-only, branded, 30d expiry | M | pending | 5.1 | |
| 5.6 | Reports list at `/(agency)/reports` — sent history, regenerate, copy link | M | pending | 5.3, 5.4, 5.5 | |
| 5.7 | Lists analytics at `/(agency)/list-analytics` — per-list funnel + signal correlation | L | pending | 4.8 | |

---

## Phase 6 · SMB portal full build (week 6)

Goal: Maria can use Mapsly daily — dashboard, reviews, competitors, search, ads, website, market.

| ID | Task | Effort | Status | Deps |
|---|---|---|---|---|
| 6.1 | SMB dashboard with 6-state KPI bar, alerts feed, top-3 fixes, KPI tiles, score breakdown | L | pending | 3.12 |
| 6.2 | SMB reviews page — unanswered queue, AI reply panel EN/ES, theme analysis, trend chart | L | pending | 3.8 |
| 6.3 | SMB competitors page — head-to-head, service coverage matrix, threat ranking | L | pending | 3.11 |
| 6.4 | SMB search visibility — keyword table with local-pack occupants, P0 opportunities | M | pending | 3.9 |
| 6.5 | SMB ads page — paradox callout, 14 keyword lanes grid, off-keyword warnings | M | pending | 3.2 |
| 6.6 | SMB website health — score rings, Core Web Vitals, 11 ranked issues | M | pending | 3.10 |
| 6.7 | SMB market reality — MSI ranking, market medians, spatial distribution map | L | pending | 3.12, 3.15 |
| 6.8 | SMB activity feed — chronological event stream | M | pending | 3.1–3.13 |
| 6.9 | SMB settings — profile, brand voice, billing | M | pending | 2.8 |

---

## Phase 7 · Billing + tier enforcement (week 7)

| ID | Task | Effort | Status | Deps |
|---|---|---|---|---|
| 7.1 | Stripe checkout — SMB Paid $29 | M | pending | 2.8 |
| 7.2 | Stripe checkout — 4 agency tiers | M | pending | 2.8 |
| 7.3 | Stripe webhook handler — subscription lifecycle events | L | pending | 2.8 |
| 7.4 | Tier-ceiling enforcement in cron jobs — pause if budget hit | M | pending | 7.3 |
| 7.5 | Customer portal redirect — manage card / cancel / upgrade | S | pending | 7.3 |
| 7.6 | 30-day money-back implementation | M | pending | 7.3 |

---

## Phase 8 · Observability + launch readiness (week 8)

| ID | Task | Effort | Status | Deps |
|---|---|---|---|---|
| 8.1 | Sentry SDK + source maps · capture all errors | M | pending | 0.1 |
| 8.2 | PostHog (optional) — event tracking for funnel + retention | M | pending | 0.1 |
| 8.3 | Admin dashboard at `/admin` — CronRun audit, daily cost, active users | M | pending | 0.2 |
| 8.4 | `/cost-audit` skill — actual vs budget | S | pending | 0.2 |
| 8.5 | `/api/admin/health` — DB + cron + queue status | S | pending | 0.2 |
| 8.6 | Launch checklist run — security audit, a11y review, payments audit | L | pending | 8.1–8.5 |
| 8.7 | Cutover from preview to production · `mapsly.ai` domain | M | pending | 8.6 | human-required |

---

## Backlog · Phase 2+ signal expansions (post-launch)

| ID | Task | Effort | Status | Deps |
|---|---|---|---|---|
| B.1 | Yelp Fusion integration (Phase 2 roadmap signal) | L | pending | 7.4 |
| B.2 | Reddit mentions via Apify | M | pending | 7.4 |
| B.3 | News mentions via Google News RSS | M | pending | 7.4 |
| B.4 | TikTok Creative Center | L | pending | 7.4 |
| B.5 | Booking system detection (Wappalyzer-extended) | M | pending | 7.4 |
| B.6 | Instagram Graph API (opt-in engagement) | L | pending | 7.4 |
| B.7 | Mindbody / Boulevard / Vagaro booking-loop attribution | XL | pending | 7.4 |
| B.8 | CallRail / Twilio call-loop attribution | XL | pending | 7.4 |
| B.9 | Quote-response time (opt-in mystery shop) | XL | pending | 7.4 |
| B.10 | Email-marketing engagement (Mailchimp / Klaviyo) | L | pending | 7.4 |

---

## How the loop reads this

The `autonomous-build-loop` skill:
1. Parses this file looking for `status: pending` rows
2. Filters by: all `Deps` are `status: completed`
3. Filters by: effort ≤ `M` (autonomous skips L+ unless explicitly allowed)
4. Filters by: no `human-required` tag
5. Picks the lowest-numbered remaining task
6. Updates status to `in_progress`, commits, starts work
7. On success, updates to `completed`, commits, picks the next one

Single source of truth. Edit this file to change priorities. Don't add comments inside the tables — keep them parseable.
