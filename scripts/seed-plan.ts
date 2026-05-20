// Idempotent seed for the domain-restructured task tracker.
// v2 · richer descriptions (user story + acceptance criteria + files + validation)
// · adds missing tasks · fixes stale statuses · sets priority for parallel waves.

import { PrismaNeon } from "@prisma/adapter-neon";
import {
  PrismaClient,
  TaskStatus,
  TaskDomain,
} from "../lib/generated/prisma/client";

interface SeedGroup {
  id: string;
  name: string;
  description: string;
  domain: TaskDomain;
  sortOrder: number;
  tasks: SeedTask[];
}

interface SeedTask {
  id: string;
  title: string;
  description: string;
  effort: "S" | "M" | "L" | "XL";
  status?: TaskStatus;
  deps?: string;
  tags?: string;
  /** 0 = highest. Used for parallel-wave ordering by the loop. */
  priority?: number;
  /** Lane lock: "auth" | "data" | "compute" | "smb-ui" | "agency-ui" | "billing" | "ops" | "i18n" | "marketing-ui" | "shared". One task per lane runs at a time. */
  parallelLane?: string;
  independent?: boolean;
  filesPlanned?: string;
}

const GROUPS: SeedGroup[] = [
  {
    id: "A",
    name: "Foundation",
    description: "Infrastructure, schema, auth, dev tooling. All shipped.",
    domain: "FOUNDATION",
    sortOrder: 0,
    tasks: [
      {
        id: "A.1",
        title: "Next.js 16 + Prisma 7 + Tailwind 4 + NextAuth scaffold",
        description:
          "Strict TS · ESLint flat config · Prettier · vitest --passWithNoTests · prisma generate via postinstall · lazy PrismaClient via Proxy · next-intl scaffold · all per .claude/rules/conventions.md.",
        parallelLane: "shared",
        effort: "M",
        status: "DONE",
      },
      {
        id: "A.2",
        title: "Prisma schema · full data model",
        description:
          "23+ models (User, Account, Session, Agency, Business, BusinessSnapshot, Review, Lighthouse, AdLib, SERP, Keyword, List, Lead, Report, CronRun, Task, TaskGroup, TaskRun, AgentInvocation, Notification, CostBudget) with composite indexes per .claude/rules/scalability.md. Validation: prisma validate + prisma db push to Neon.",
        parallelLane: "shared",
        effort: "M",
        status: "DONE",
      },
      { id: "A.3", title: "Neon Postgres + DB push", description: "Schema materialized in Neon · 23 tables · 50+ indexes. Adapter via @prisma/adapter-neon. Validation: SELECT COUNT from information_schema.", parallelLane: "shared",
        effort: "S", status: "DONE" },
      { id: "A.4", title: "GitHub Actions CI · validate · build · test · ci-passed", description: "Required-status gate workflow at .github/workflows/ci.yml. Runs format-check + typecheck + lint + build (stub env vars) + test:run + ci-passed aggregator. Blocks merge if any step fails.", parallelLane: "shared",
        effort: "S", status: "DONE" },
      { id: "A.5", title: "Auto-merge workflow + autonomous-ready label", description: ".github/workflows/auto-merge.yml fires on autonomous-ready label + branch starting auto/ or enhance/. Runs gh pr merge --squash --auto --delete-branch. Labels: autonomous, autonomous-ready, needs-review created via API.", parallelLane: "shared",
        effort: "S", status: "DONE" },
      { id: "A.6", title: "Vercel deploy · mapsly.ai · dev.mapsly.ai", description: "Production domain wired to www.mapsly.ai. Subdomain dev.mapsly.ai via DNS CNAME → Vercel. Middleware host-based rewrite to /dev. Env vars in Vercel project. Postinstall runs prisma generate (INC-06).", parallelLane: "shared",
        effort: "S", status: "DONE" },
      { id: "A.7", title: "Incident-prevention system", description: ".claude/memory/incidents.md seeded with 15 INC entries. .claude/rules/incident-prevention.md as load-bearing rule. autonomous-build-loop SKILL mandates incidents read first + new entries before close.", parallelLane: "shared",
        effort: "M", status: "DONE" },
      { id: "A.8", title: "Native macOS launchd loop", description: "scripts/launchd/ — loop-tick.sh + ai.mapsly.loop.plist + install.sh + loop-prompt.md. Escapes Cowork FUSE limitation (INC-14). Runs every 5 min via launchd. Honors loop-lock.json state (idle/running/cooldown/paused).", parallelLane: "shared",
        effort: "M", status: "DONE" },
      {
        id: "A.9",
        title: "E2E test infrastructure · Playwright + fixtures",
        description:
          "As a developer I want a working E2E test framework so tests can be added incrementally. Acceptance: Playwright installed; tests/e2e/{sign-in,create-list,mark-contacted}.spec.ts skeleton; CI job test:e2e wired into ci.yml; headless Chromium config; test data seeded via scripts/test-seed.ts. Files: playwright.config.ts, tests/e2e/, scripts/test-seed.ts. Validation: pnpm test:e2e green with stub data.",
        effort: "M",
        priority: 20,
      },
    ],
  },
  {
    id: "B",
    name: "Marketing surface (public)",
    description: "Public pages: landing, for-SMB, for-Agency, pricing, sign-in, legal, SEO.",
    domain: "MARKETING",
    sortOrder: 1,
    tasks: [
      {
        id: "B.0",
        title: "Design system · shared components (Tile, Card, Pill, Button, Input, Modal)",
        description:
          "As a developer I want a shared component library so every portal page doesn't reinvent the same primitives. Acceptance: components/ui/{Tile, Card, Pill, Button, Input, Modal, Toast, Skeleton}.tsx. Each accepts variant + tone (smb / agency / neutral). Tailwind 4 tokens via @theme. Tested in Storybook? No (per testing.md, skip). Validation: import + render in B.1 and F.1 without restyling.",
        effort: "L",
        deps: "A.1",
        tags: "design-system,foundation",
        priority: 10,
      },
      {
        id: "B.1",
        title: "Main landing · mapsly.ai/",
        description:
          "As an anonymous visitor I want a single landing that lets me choose SMB or Agency path. Acceptance: hero with audience-switcher (cream+coral for SMB section, cool-gray+indigo for Agency). 8-block structure per _design/landing/index.html. Outcome-first copy (no jargon in SMB section, jargon-OK in Agency section). CTAs route to /for-smb or /for-agencies. Files: app/[locale]/(marketing)/page.tsx, components/marketing/Hero.tsx. Validation: browser anon + Lighthouse perf ≥ 90 + Lighthouse SEO ≥ 95 + copy-reviewer pass for both audiences.",
        parallelLane: "marketing-ui",
        effort: "L",
        deps: "B.0",
        tags: "marketing,smb,agency",
      },
      {
        id: "B.2",
        title: "For-Agencies landing · /for-agencies",
        description:
          "Tom's voice: jargon-OK, numbers over adjectives. Acceptance: 4 tier cards ($49 Solo / $99 Growth / $249 Pro / $499 Boutique), sample-list preview, calculator 'how many qualified leads in your metro?', signal-vocabulary teaser. Validation: ux-reviewer-agency pass + copy-reviewer (no SMB warm tone leak).",
        parallelLane: "marketing-ui",
        effort: "L",
        deps: "B.0",
        tags: "marketing,agency",
      },
      {
        id: "B.3",
        title: "For-SMB landing · /for-smb",
        description:
          "Maria's voice: plain English, no acronyms. Acceptance: 'See what's wrong with your spa this week — for $29/mo.' headline, outcome-first KPI showcase, mobile-first layout, simple onboarding promise. Validation: ux-reviewer-smb pass + copy-reviewer (no jargon leak).",
        parallelLane: "marketing-ui",
        effort: "M",
        deps: "B.0",
        tags: "marketing,smb",
      },
      {
        id: "B.4",
        title: "Pricing page · /pricing",
        description:
          "Acceptance: SMB single tier ($29) + 4 agency tiers in compare-table format. FAQ section. Trust badges (Stripe, SOC2-soon). Each tier CTA opens Stripe checkout (depends G.1). Files: app/[locale]/(marketing)/pricing/page.tsx. Validation: browser checkout flow click → Stripe test mode + ux-reviewer.",
        parallelLane: "marketing-ui",
        effort: "M",
        deps: "B.0",
        tags: "marketing,billing",
      },
      {
        id: "B.5",
        title: "Public business profile · /biz/[slug]",
        description:
          "SEO-targeted landing for indexed businesses. Mapsly Score visible (anonymously). 'Claim this business' CTA flows to SMB onboarding. Acceptance: Schema.org LocalBusiness + AggregateRating JSON-LD, canonical URL, hreflang per locale, OG image. Files: app/[locale]/(marketing)/biz/[slug]/page.tsx, lib/seo/business-jsonld.ts. Validation: schema.org validator + Lighthouse SEO ≥ 95.",
        parallelLane: "marketing-ui",
        effort: "L",
        deps: "C.9,D.2",
        tags: "marketing,seo",
      },
      {
        id: "B.6",
        title: "Sign-in flow · /signin + /signin/check-email",
        description:
          "NextAuth v5 magic-link via Resend. Acceptance: email input → POST to /api/auth/signin/email → magic link in Resend inbox → click → session created → redirect by role (SMB → /dashboard, Agency → /lists, Admin → /admin). Files: app/[locale]/signin/page.tsx, app/[locale]/signin/check-email/page.tsx, lib/auth.ts (already exists). Validation: browser sign-in flow + DB (VerificationToken + Session rows asserted) + Gmail tab (verify magic-link email delivered to sarminvictor@gmail.com).",
        parallelLane: "marketing-ui",
        effort: "M",
        deps: "A.3",
        tags: "auth",
        priority: 5,
      },
      {
        id: "B.7",
        title: "SEO infrastructure · sitemap + robots + hreflang + structured data",
        description:
          "Acceptance: app/sitemap.ts generates valid XML (splits at 50K URLs). app/robots.ts allows public, blocks /api+/admin. Every public page exports metadata with alternates.languages for all 4 locales. JSON-LD per page-type (Article on blog, FAQPage on FAQ blocks). x-default points to /en. Files: app/sitemap.ts, app/robots.ts, lib/seo/. Validation: Google Search Console submission + Lighthouse SEO ≥ 95.",
        parallelLane: "marketing-ui",
        effort: "M",
        deps: "B.1",
        tags: "seo",
      },
      {
        id: "B.8",
        title: "Marketing copy in 4 locales (en-US, es-US, en-CA, fr-CA)",
        description:
          "messages/{en,es,en-CA,fr}.json for marketing namespace. Native-speaker review for es and fr (NO machine translation per copy-voice.md). Service vocabulary varies (patients → pacientes for med-spa). Validation: per-locale browser smoke + copy-reviewer for voice consistency.",
        effort: "L",
        deps: "B.1,I.1",
        tags: "marketing,i18n",
      },
      {
        id: "B.9",
        title: "Legal pages · /privacy /terms /cookies",
        description:
          "Required for Stripe + Meta Business Verification + GDPR. Acceptance: privacy policy (data we collect, retention, GDPR rights), terms of service, cookie policy. Generated via template + Mapsly-specific clauses. Linked from every footer + sign-up flow. Files: app/[locale]/(marketing)/{privacy,terms,cookies}/page.tsx. Validation: browser + GDPR rule check.",
        effort: "M",
        deps: "B.0",
        tags: "legal,marketing",
      },
      {
        id: "B.10",
        title: "Analytics event tracking · GA4 + GTM + custom events",
        description:
          "GA4 + GTM wired via @next/third-parties/google. Custom events: signup_started, signup_completed, list_created, lead_marked_contacted, subscription_started, subscription_canceled. Conversion funnels in GA4 dashboard. Files: app/[locale]/(marketing)/layout.tsx (script), lib/analytics/track.ts. Validation: browser → check GA4 realtime + GTM preview.",
        parallelLane: "marketing-ui",
        effort: "M",
        deps: "B.0",
        tags: "analytics,marketing",
      },
    ],
  },
  {
    id: "C",
    name: "Data collection layer",
    description: "External APIs, cron jobs, cost tracking. Populates the 2.1M business index.",
    domain: "DATA",
    sortOrder: 2,
    tasks: [
      {
        id: "C.0",
        title: "Dev seed data · 500 sample businesses + 5K reviews + Lighthouse audits",
        description:
          "Without realistic data, SMB dashboard + Hunter UI can't be tested locally or in CI. Acceptance: scripts/seed-dev.ts populates 500 businesses across 5 metros (Miami, Toronto, LA, NYC, Calgary) and 3 categories (med-spa, auto-body, restaurant). Generates 5K reviews with sentiment distribution. Generates Lighthouse audit rows for 100 of them. Idempotent. Files: scripts/seed-dev.ts. Validation: pnpm seed:dev + Postgres MCP SELECT COUNT verifies.",
        parallelLane: "data",
        effort: "M",
        deps: "A.3",
        tags: "dev-data",
        priority: 8,
      },
      {
        id: "C.1",
        title: "Cost-counter + CronRun lifecycle",
        description:
          "lib/cost/cost-counter.ts uses AsyncLocalStorage to bind a CronRun to all external calls. Increments costUsd on every adapter call. Throws if no open CronRun (enforces 'no live API in user request path' per cost-discipline.md). Files: lib/cost/cost-counter.ts, lib/middleware/no-live-api.ts. Validation: unit tests for nesting + missing CronRun throw.",
        parallelLane: "data",
        effort: "S",
        deps: "A.2",
        priority: 12,
      },
      {
        id: "C.2",
        title: "Cache layer · Redis-backed · 24h TTL with cacheTag invalidation",
        description:
          "lib/cache/index.ts. Key format: mapsly:{vendor}:{operation}:{stable-hash}. Cache hits tracked in CronRun.meta.cacheHits. Falls through gracefully if Redis unavailable. Files: lib/cache/index.ts, lib/cache/kv.ts. Validation: integration test seeds + reads + asserts cache hit.",
        effort: "S",
        deps: "C.1",
      },
      {
        id: "C.3",
        title: "services/dataforseo · all adapters (Maps, SERP, Local, Reviews, Keyword, Lighthouse)",
        description:
          "6 adapters · each wrapped with cost-counter + 24h cache + retry (max 2 with exponential backoff) + timeout 10s. Uses DataForSEO Standard queue (10× cheaper than Live). Files: services/dataforseo/{maps-search,serp-organic,serp-local-pack,reviews,keyword-volume,lighthouse}.ts. Validation: mocked unit tests + one real integration call counting cost in CronRun.",
        effort: "XL",
        deps: "C.1,C.2",
      },
      {
        id: "C.4",
        title: "services/meta-ad-library",
        description: "ads_archive endpoint adapter. Daily competitor ad scan. Cost-tracked. Cache 6h. Files: services/meta-ad-library/ads-archive.ts. Validation: mocked unit + integration test with one real query.",
        parallelLane: "data",
        effort: "M",
        deps: "C.1,C.2",
      },
      {
        id: "C.5",
        title: "services/lighthouse · DataForSEO + custom DOM checks",
        description: "Wraps DataForSEO Lighthouse + custom DOM extraction: schema markup presence, NAP consistency, booking-CTA detection. Files: services/lighthouse/audit.ts, services/lighthouse/dom-checks.ts. Validation: unit on DOM checks + integration with sample biz.",
        parallelLane: "data",
        effort: "M",
        deps: "C.3",
      },
      {
        id: "C.6",
        title: "services/email-verify · SMTP verification",
        description: "Verify SMB/agency owner emails are deliverable before storing. Used for cohort outreach + onboarding validity. Files: services/email-verify/smtp.ts. Validation: unit + manual test against known-good + known-invalid emails.",
        parallelLane: "data",
        effort: "S",
        deps: "C.1",
      },
      {
        id: "C.7",
        title: "services/ai-haiku · Anthropic SDK wrapper",
        description: "Wraps Anthropic SDK for review sentiment + reply drafts + one-pager copy. Cost-tracked (Haiku for cheap, Sonnet for tone). Files: services/ai-haiku/{sentiment,reply-draft,copy-gen}.ts. Validation: unit + sample-input integration.",
        effort: "S",
        deps: "C.1",
      },
      {
        id: "C.8",
        title: "Cron · daily handlers (6 routes)",
        description:
          "Six routes under app/api/cron/daily/{brand-hijack-scan, ad-library-diff, new-reviews-delta, indexer-new-businesses, list-refresh-daily, google-ads-transparency}. Each: opens CronRun, processes a batch, closes CronRun, revalidates tags. Vercel cron schedule in vercel.json. Files: app/api/cron/daily/**. Validation: integration tests against seeded data.",
        effort: "L",
        deps: "C.3,C.4",
      },
      {
        id: "C.9",
        title: "Cron · weekly handlers (7 routes)",
        description:
          "Weekly: business-profile-refresh, reviews-full-pull (+ sentiment + AI replies), serp-rank-scan, lighthouse-audit, competitor-diff, snapshot-write (Mapsly Score + MSI compute), list-refresh-weekly. Files: app/api/cron/weekly/**. Validation: integration on seeded businesses; assert BusinessSnapshot row written.",
        parallelLane: "data",
        effort: "XL",
        deps: "C.3,C.5,D.1",
      },
      {
        id: "C.10",
        title: "Cron · monthly handlers (4 routes)",
        description: "keyword-volume-refresh, market-census, industry-baseline, email-verification. Slow data; budget-heavy; runs against tier-permitted businesses only. Files: app/api/cron/monthly/**. Validation: integration + cost-budget assertion.",
        parallelLane: "data",
        effort: "L",
        deps: "C.3",
      },
      {
        id: "C.11",
        title: "API rate limiting middleware",
        description:
          "lib/middleware/rate-limit.ts using @upstash/ratelimit. Defaults: public 60/min/IP, auth 30/min/user, webhooks 200/min. Per-route override decorator. Files: lib/middleware/rate-limit.ts, hook into specific routes. Validation: integration test 100 requests in 1 min returns 429.",
        parallelLane: "data",
        effort: "S",
        deps: "C.2",
        tags: "security",
      },
    ],
  },
  {
    id: "D",
    name: "Compute / scoring",
    description: "60+ signal vocabulary, scoring formulas, AI classification. Mapsly's moat.",
    domain: "COMPUTE",
    sortOrder: 3,
    tasks: [
      {
        id: "D.1",
        title: "Signal registry · 60+ filterable signals",
        description:
          "modules/signals/registry.ts. Canonical definition for every signal: source, storage, refresh cadence, comparators, default value, tooltip. Each signal has 5 components (see signal-engineering.md): source, storage, refresh cadence, filter def, display surface. Hunter UI (F.2) + Prospect view (F.4) read from this. Files: modules/signals/registry.ts, modules/signals/categories.ts. Validation: unit per-signal-type comparator eval + signal-engineer agent review.",
        parallelLane: "compute",
        effort: "L",
        deps: "A.2",
        tags: "signals,moat",
        priority: 15,
      },
      {
        id: "D.2",
        title: "Mapsly Score formula · 6-dim weighted composite",
        description:
          "modules/scoring/mapsly-score.ts. 6-dim weighted composite (reputation 25, communication 15, profile 15, trust 15, pricing 15, brand 15). Clamped 0-10. Unit tested with edge cases (perfect business, brand-new business, abandoned listing). Files: modules/scoring/mapsly-score.ts, modules/scoring/__tests__/. Validation: 100% test coverage on the formula.",
        parallelLane: "compute",
        effort: "M",
        deps: "D.1",
      },
      {
        id: "D.3",
        title: "Market Share Index (MSI) rank within metro",
        description: "Within-metro ranking by Mapsly Score, weighted by review volume + ad spend visibility. Runs inside snapshot-write cron. Stored on BusinessSnapshot.msiRank + msiTotal. Files: modules/scoring/msi.ts. Validation: unit + integration on seeded multi-business metro.",
        parallelLane: "compute",
        effort: "M",
        deps: "D.2",
      },
      {
        id: "D.4",
        title: "Hunter filter evaluation engine",
        description:
          "modules/hunter/evaluate.ts. Takes filter spec (signals + comparators + values) → returns matching Business IDs. Optimized for incremental refresh (only changed rows re-evaluated). Files: modules/hunter/evaluate.ts, modules/hunter/incremental.ts. Validation: unit per-comparator (<, ≤, =, ≥, between, missing, present) + integration on 500-business dev seed.",
        parallelLane: "compute",
        effort: "L",
        deps: "D.1",
      },
      {
        id: "D.5",
        title: "Match score · per-lead per-list ranking",
        description: "modules/scoring/match-score.ts. Within a list, rank leads by how strongly they match the filter signals. Surfaced as 'why this lead qualifies' in Prospect view (F.4). Files: modules/scoring/match-score.ts. Validation: unit + integration test on a seeded list.",
        parallelLane: "compute",
        effort: "M",
        deps: "D.4",
      },
      {
        id: "D.6",
        title: "AI sentiment + theme extraction for reviews",
        description: "ai-haiku call per review on every weekly pull. Stores Review.sentiment (POS/NEU/NEG) + Review.themes[] (atmosphere, price, staff, parking, etc.). Files: modules/scoring/review-classifier.ts. Validation: unit on classifier prompt + manual review on 20 known samples.",
        parallelLane: "compute",
        effort: "M",
        deps: "C.7,C.9",
      },
      {
        id: "D.7",
        title: "AI reply draft generation (EN + ES)",
        description: "On every new review, generate aiReplyDraftEn + aiReplyDraftEs using OpenAI client (model from D.8 winner). Tone matches SMB's reply-tone setting (warm/professional/casual). Stored on Review row. Files: modules/scoring/ai-reply.ts. Validation: unit + cohort A/B test eventually + browser SMB acceptance.",
        parallelLane: "compute",
        effort: "M",
        deps: "C.7,D.8",
      },
      {
        id: "D.8",
        title: "AI model A/B test · gpt-5.4-mini vs gpt-5.4-nano on real review data",
        description: "As cost-conscious owner I want to run real Mapsly use cases through both gpt-5.4-mini and gpt-5.4-nano to pick the cheapest model that produces acceptable output. Acceptance: scripts/model-ab-test.ts runs 50 real reviews from seeded data through BOTH models for 3 tasks (sentiment classification, English reply draft, Spanish reply draft). Compares: output quality (manual rubric 1-10), token cost, latency. If nano scores >= 80% of mini quality, use nano. Writes winner to .claude/memory/model-decision.json. C.7/D.6/D.7 read this file for default model choice. Files: scripts/model-ab-test.ts, .claude/memory/model-decision.json. Validation: run produces decision file + cost saved estimated + sample outputs reviewable on /dev surface.",
        parallelLane: "compute",
        effort: "M",
        deps: "C.7,C.0",
        tags: "cost-discipline,ai",
        priority: 14,
      },
    ],
  },
  {
    id: "E",
    name: "SMB portal · Maria's pages",
    description: "Warm + simple. Plain English. Patients/treatments vocabulary. Mobile-first.",
    domain: "SMB_PORTAL",
    sortOrder: 4,
    tasks: [
      {
        id: "E.0",
        title: "SMB component library (KPI tile · alert card · fix card · score breakdown)",
        description: "Audience-specific components for Maria's pages. KPITile (big number + label + tooltip), AlertCard (what needs attention + CTA), FixCard (plain-English action + impact preview), ScoreBreakdown (6-dim sub-scores). All cream+coral palette. Files: modules/smb-dashboard/components/. Validation: render in E.1 without restyling + ux-reviewer-smb.",
        parallelLane: "smb-ui",
        effort: "M",
        deps: "B.0",
        tags: "design-system,smb",
        priority: 18,
      },
      { id: "E.1", title: "SMB dashboard · /(smb)/dashboard", description: "Maria's home. Hero KPI: Mapsly Score 6.2/10. 5 supporting KPIs. 'What needs your attention today' (max 4 alert cards). Top 3 fixes ordered by impact. This-week activity feed. Files: app/[locale]/(smb)/dashboard/page.tsx. Validation: browser anon (redirect) + signed-in SMB + Lighthouse + ux-reviewer-smb + copy-reviewer (no jargon).", parallelLane: "smb-ui",
        effort: "L", deps: "D.2,E.0,C.9" },
      { id: "E.2", title: "SMB reviews page · /(smb)/reviews", description: "Tabs: Unanswered (default) / Negative / All / By theme. Per review: stars + date + text + AI reply draft (EN+ES toggle). 'Post to Google' CTA. Right rail: rating distribution, theme analysis, reply-tone settings. Files: app/[locale]/(smb)/reviews/page.tsx. Validation: browser SMB + DB (AI reply persistence) + ux + copy.", parallelLane: "smb-ui",
        effort: "L", deps: "D.6,D.7,E.0" },
      { id: "E.3", title: "SMB competitors page · /(smb)/competitors", description: "Head-to-head vs 3 nearest competitors. Service-coverage matrix. Threat ranking. 'Where you beat them' / 'Where they beat you' wedges. Files: app/[locale]/(smb)/competitors/page.tsx. Validation: browser + ux.", parallelLane: "smb-ui",
        effort: "L", deps: "C.9,E.0" },
      { id: "E.4", title: "SMB search visibility · /(smb)/search", description: "Keyword table: term, monthly volume, your position, who else ranks in local 3-pack. P0 opportunities (high volume + low your-rank). Plain English: 'When someone searches X you appear Y'. Files: app/[locale]/(smb)/search/page.tsx. Validation: browser + ux + copy.", parallelLane: "smb-ui",
        effort: "M", deps: "D.1,C.9,E.0" },
      { id: "E.5", title: "SMB ads page · /(smb)/ads", description: "Competitor ad copy by keyword (Meta + Google Ads Transparency). 'Off-keyword warning' when ads don't match SMB services. 14-keyword lane grid. Files: app/[locale]/(smb)/ads/page.tsx. Validation: browser + DB.", parallelLane: "smb-ui",
        effort: "M", deps: "C.4,C.8,E.0" },
      { id: "E.6", title: "SMB settings · /(smb)/settings", description: "Business info (name, address, hours, services). Reply-tone (warm/professional/casual). Locale preference. Notification prefs. Stripe billing card. Files: app/[locale]/(smb)/settings/page.tsx. Validation: browser + DB persistence + form validation.", parallelLane: "smb-ui",
        effort: "M", deps: "B.6,E.0,G.4" },
      { id: "E.7", title: "SMB onboarding flow", description: "4-step wizard: claim business → set vocabulary (industry) → connect Google Business Profile → invite team. Each step has skip. Mobile-friendly. Files: app/[locale]/(smb)/onboarding/page.tsx. Validation: browser multi-step + DB state per step + a11y.", parallelLane: "smb-ui",
        effort: "L", deps: "B.6,E.0" },
    ],
  },
  {
    id: "F",
    name: "Agency portal · Tom's pages",
    description: "Tool-y + dense. Jargon-OK. Keyboard-first. Bulk actions.",
    domain: "AGENCY_PORTAL",
    sortOrder: 5,
    tasks: [
      {
        id: "F.0",
        title: "Agency component library (filter row · lead row · status pill · bulk-action bar · table)",
        description: "Audience-specific components. FilterRow (signal + comparator + value), LeadRow (clickable, status pill, bulk-select checkbox), StatusPill (NEW/CONTACTED/REPLIED/WON/LOST/HIDDEN), BulkActionBar (sticky), DenseTable (resizable cols, density toggle). All cool-gray+indigo. Files: modules/agency/components/. Validation: render in F.1+F.3 + ux-reviewer-agency.",
        parallelLane: "agency-ui",
        effort: "M",
        deps: "B.0",
        tags: "design-system,agency",
        priority: 18,
      },
      { id: "F.1", title: "Agency lists · /(agency)/lists", description: "Service-template strip top (Website / Meta ads / Local SEO / etc.). Today's-new-matches summary row. Lists grid · service badge per card · hover-reveal actions (clone, pause, more). Paused section below. Files: app/[locale]/(agency)/lists/page.tsx. Validation: browser + ux-reviewer-agency.", parallelLane: "agency-ui",
        effort: "L", deps: "D.4,F.0" },
      {
        id: "F.2",
        title: "Hunter UI · /(agency)/search",
        description: "As an agency owner I want to filter the 2.1M business index by signal to build a qualified-lead list. Acceptance: 3-step flow (template → market → tune). 60+ filter rows reading D.1 signal registry. Live match count debounced 400ms reading D.4 evaluation engine. Sticky preview bar: count + filter summary + 'Save as list'. ⌘K + Tab navigation. Files: app/[locale]/(agency)/search/page.tsx, modules/hunter/components/. Validation: browser multi-comparator combinations + DB filter-eval assertions + perf (Lighthouse on first match) + ux-reviewer-agency.",
        parallelLane: "agency-ui",
        effort: "XL",
        deps: "D.1,D.4,F.0",
        tags: "hunter,moat",
      },
      { id: "F.3", title: "List detail · /(agency)/lists/[id]", description: "Hero: pitch + 5 KPIs. Filter chips bar. Status tabs: New / Contacted / Replied / Won / Lost / Hidden. Table rows: business, why-qualified signals, status pill (clickable), contact, action. Sticky bulk-action bar. Files: app/[locale]/(agency)/lists/[id]/page.tsx. Validation: browser state transitions + DB + ux + bulk-action perf.", parallelLane: "agency-ui",
        effort: "L", deps: "F.1,F.0" },
      {
        id: "F.4",
        title: "Prospect detail · /(agency)/prospect/[businessId]",
        description: "Hero: avatar, name, address, prev/next nav, Mark Contacted, Mark Client, Generate one-pager. Top stats row (6 KPIs). 'Why this lead qualifies' — 4 numbered pitch wedges with evidence footers. Signal blocks: Reviews / Competitors / Search / Ads / Website. Files: app/[locale]/(agency)/prospect/[businessId]/page.tsx. Validation: browser navigation + DB + Match Score assertion + ux.",
        parallelLane: "agency-ui",
        effort: "XL",
        deps: "D.5,F.3,F.0",
      },
      { id: "F.5", title: "List analytics · /(agency)/list-analytics", description: "4-stat header (surfaced 90d / contact rate / reply rate / closed won). Per-list table with mini-funnel viz per row. Signal correlation panel (which signals predict replies). Files: app/[locale]/(agency)/list-analytics/page.tsx. Validation: DB aggregate + ux.", parallelLane: "agency-ui",
        effort: "M", deps: "F.3,D.4" },
      { id: "F.6", title: "One-pager PDF generation", description: "Generate per-prospect PDF with Solea-template branding. Headline insight, 4 pitch wedges, evidence sections. Write to Vercel Blob. Files: modules/reports/one-pager-pdf.ts. Validation: integration test (PDF generated + Blob URL returned + content match).", parallelLane: "agency-ui",
        effort: "L", deps: "F.4" },
      { id: "F.7", title: "CSV export with column picker", description: "Per-list CSV download. User chooses columns (business name, address, phone, score, status, etc.). Writes to Vercel Blob, signed URL, 30d expiry. Files: modules/reports/csv-export.ts. Validation: integration test (CSV bytes + content sample assertion).", parallelLane: "agency-ui",
        effort: "S", deps: "F.3" },
      { id: "F.8", title: "Shareable link · /share/[publicShareId]", description: "Read-only public route showing one-pager content. Branded with agency name + logo. 30d expiry. View counter. Auto-noindex. Files: app/[locale]/(public)/share/[id]/page.tsx, modules/reports/share-link.ts. Validation: browser anon + noindex header + view counter increment.", parallelLane: "agency-ui",
        effort: "M", deps: "F.6" },
      { id: "F.9", title: "Agency settings · /(agency)/settings", description: "Team management (invite/remove members). Default metro + categories. Billing (current plan, change tier, invoices). API keys section (future). Files: app/[locale]/(agency)/settings/page.tsx. Validation: browser + DB on team changes + invitation email flow.", parallelLane: "agency-ui",
        effort: "M", deps: "B.6,G.4" },
      { id: "F.10", title: "Agency onboarding flow", description: "3-step: agency profile → choose first service template → see first 50 free leads. Skips allowed. Drops into lists view at end. Files: app/[locale]/(agency)/onboarding/page.tsx. Validation: browser multi-step + DB per-step persistence.", parallelLane: "agency-ui",
        effort: "M", deps: "B.6,F.1" },
      { id: "F.11", title: "Global ⌘K business search · top-bar quick lookup", description: "Type business name or URL → fuzzy match → click → open Prospect detail. Keyboard-driven. Files: components/agency/CommandK.tsx, modules/business-search/. Validation: browser keyboard navigation + DB search query.", parallelLane: "agency-ui",
        effort: "S", deps: "C.8,F.4" },
    ],
  },
  {
    id: "G",
    name: "Billing",
    description: "Stripe checkout · subscription state · tier enforcement.",
    domain: "BILLING",
    sortOrder: 6,
    tasks: [
      { id: "G.1", title: "Stripe checkout · subscription create", description: "5 price IDs (SMB $29 + 4 agency tiers). Checkout session creator. Stripe Customer creation, link to User/Agency. Files: app/api/billing/checkout/route.ts, modules/billing/checkout.ts. Validation: browser → Stripe test mode + DB Customer + Subscription rows.", parallelLane: "billing",
        effort: "M", deps: "B.6" },
      { id: "G.2", title: "Stripe webhook · subscription lifecycle (idempotent)", description: "/api/webhooks/stripe. Verify signature with STRIPE_WEBHOOK_SECRET. Idempotency via StripeWebhookEvent table. Handle: checkout.completed, invoice.paid, invoice.payment_failed, subscription.updated, subscription.deleted. Files: app/api/webhooks/stripe/route.ts. Validation: payments-auditor + integration (replay = 200 no double-process).", parallelLane: "billing",
        effort: "M", deps: "G.1" },
      { id: "G.3", title: "Tier enforcement · cost ceilings + feature gating", description: "lib/cost/tier-ceiling.ts. Per-tier monthly cap. Cron skips business if owner-agency ceiling reached. Agency features gated by plan. Files: lib/cost/tier-ceiling.ts, lib/middleware/feature-gate.ts. Validation: integration test simulating each tier hitting ceiling.", parallelLane: "billing",
        effort: "M", deps: "G.2,C.1" },
      { id: "G.4", title: "Billing UI · current plan + invoices + change tier", description: "Embedded in Agency settings + SMB settings. Show current plan, days remaining, last invoice link (Stripe-hosted). Change tier → Stripe customer-portal session. Files: components/billing/. Validation: browser + Stripe test mode change-tier flow.", parallelLane: "billing",
        effort: "M", deps: "G.1" },
    ],
  },
  {
    id: "H",
    name: "Ops · self-improvement infrastructure",
    description: "Internal tooling: dev dashboard, task tracker, incidents, process-enhancer.",
    domain: "OPS",
    sortOrder: 7,
    tasks: [
      { id: "H.1", title: "dev.mapsly.ai dashboard · core", description: "Hero tiles + cards (Loop control, DORA, Plan progress, Sessions 7d, Service health, Cron+API health, Auto-enhance signals, Recent commits, Open PRs). Refresh button + 30s AutoRefresh. Shipped.", parallelLane: "ops",
        effort: "XL", deps: "A.6", status: "DONE" },
      { id: "H.2", title: "Task tracker · DB-backed with TaskGroup + TaskRun models", description: "Postgres Task + TaskGroup + TaskRun + AgentInvocation + Notification + CostBudget. Seed from this file. Dashboard reads from DB. /dev/tasks list grouped by domain. Shipped v0.3.0+.", parallelLane: "ops",
        effort: "L", deps: "A.2", status: "DONE" },
      { id: "H.3", title: "/dev/tasks/[id] detail page with edit + run history + span tree", description: "Per-task page with editable form. Run history with 5-dim scorecard, agents used, gates passed, validation strategy + outcomes, AgentInvocation span tree (Honeycomb-style). Shipped v0.3.0+.", parallelLane: "ops",
        effort: "L", deps: "H.2", status: "DONE" },
      { id: "H.4", title: "Edit + Add + Delete tasks from UI", description: "Server actions backed by Prisma + Zod. Inline status menu on list. Full edit on detail. New-task modal per group. Soft-delete via SKIPPED status. Shipped v0.3.0.", parallelLane: "ops",
        effort: "M", deps: "H.3", status: "DONE" },
      { id: "H.5", title: "Loop reads next task from DB (not PLAN.md)", description: "Loop prompt updated to query Task table: status=PENDING, deps satisfied, priority+sortOrder ordering. On claim: status=IN_PROGRESS, open TaskRun. On close: write TaskRun + bump Task.status + denormalized scores. Shipped v0.3.0.", parallelLane: "ops",
        effort: "M", deps: "H.2", status: "DONE" },
      { id: "H.6", title: "process-enhancer agent · meta-loop (clusters incidents → opens self-improvement PRs)", description: "Daily scheduled. Reads incidents.md + last-N TaskRun + sessions JSON. Clusters patterns. Opens enhance/ PRs (rule rewrites, agent prompt tweaks). Writes enhance-signals.json. Dry-run script exists at scripts/process-enhancer-dryrun.ts. Validation: dry-run produces ≥1 signal on the 15 INC entries.", parallelLane: "ops",
        effort: "L", deps: "H.2", priority: 30 },
      { id: "H.7", title: "Quality gates panel per TaskRun", description: "Show: CI badge, deploy result, Lighthouse score, code-reviewer verdict, test-writer added (N) tests, performance-auditor LCP/CLS/INP, ux-reviewer-{audience} pass/fail, copy-reviewer pass/fail, scorer 5-dim card. Rendered on detail page. Shipped v0.3.1.", effort: "M", deps: "H.3", status: "DONE" },
      { id: "H.8", title: "DORA metrics card + AgentInvocation span tree + Loop control card", description: "Derives deploy freq + lead time p50/p95 + change failure rate from existing TaskRun. AgentInvocation per-agent spans render as Honeycomb-style timeline on detail page. Loop control card with pause/resume/clear-cooldown. Shipped v0.3.3.", parallelLane: "ops",
        effort: "L", deps: "H.2", status: "DONE" },
      { id: "H.9", title: "Validation framework + Browser-testing rule", description: ".claude/rules/validation.md (per-task validation strategy: unit/integration/browser/DB/email/perf/a11y). .claude/rules/browser-testing.md (multi-user Claude in Chrome MCP). Test data lifecycle (seed→test→cleanup). Shipped v0.3.1.", parallelLane: "ops",
        effort: "M", deps: "H.5", status: "DONE" },
      { id: "H.10", title: "Notification + CostBudget models + post-merge rollback policy", description: "Notification table for loop→Viktor inbox (CRITICAL/ERROR/WARN/INFO). CostBudget per-scope daily/weekly/monthly enforcement. Post-merge Sentry health check + auto-revert if regression. Shipped v0.3.2.", parallelLane: "ops",
        effort: "M", deps: "H.2", status: "DONE" },
      { id: "H.11", title: "Agent orchestration rule · concurrency budget + sequencing", description: ".claude/rules/agent-orchestration.md. Caps research at 6 parallel, review at 5. Sequencing rules (code-reviewer before scorer, security before payments). Token-aware scheduling. Shipped v0.3.3.", parallelLane: "ops",
        effort: "S", deps: "H.5", status: "DONE" },
    ],
  },
  {
    id: "I",
    name: "i18n · 4 locales",
    description: "en-US default · es-US · en-CA · fr-CA.",
    domain: "I18N",
    sortOrder: 8,
    tasks: [
      { id: "I.1", title: "next-intl scaffold · app/[locale]/ tree", description: "i18n/routing.ts. messages/{en,es,en-CA,fr}.json scaffold. Locale switcher. Auto-detect via Accept-Language. Cookie persistence. Shipped.", effort: "M", deps: "A.1", status: "DONE" },
      { id: "I.2", title: "Spanish (es-US) translation of marketing copy", description: "messages/es.json populated for marketing namespace. Native-speaker review (no MT). Service vocabulary (patients → pacientes for med-spa).", parallelLane: "i18n",
        effort: "M", deps: "I.1,B.1", tags: "human-required" },
      { id: "I.3", title: "Quebec French (fr-CA) translation", description: "messages/fr.json. Native Quebec French reviewer. CAD currency formatting. Locale-specific date formats.", parallelLane: "i18n",
        effort: "M", deps: "I.1,B.1", tags: "human-required" },
      { id: "I.4", title: "Canadian English (en-CA) overrides", description: "messages/en-CA.json with only overrides vs en (cheque vs check, neighbour, etc.). Fallback chain to en. Files: messages/en-CA.json. Validation: routing-test for /en-ca path + locale-specific copy.", parallelLane: "i18n",
        effort: "S", deps: "I.1", priority: 22 },
      { id: "I.5", title: "Currency + date locale-aware formatting", description: "useFormatter() throughout. en-US: $29.99 May 17. fr-CA: 29,99 $ CA 17 mai. Each Price + Date component reads locale from useLocale(). Files: components/i18n/Price.tsx, components/i18n/Date.tsx. Validation: snapshot tests per locale.", parallelLane: "i18n",
        effort: "S", deps: "I.1", priority: 22 },
      { id: "I.6", title: "Translated route pathnames", description: "Per i18n/routing.ts pathnames: /for-agencies → /para-agencias / /pour-agences. /lists → /listas / /listes. Link from next-intl. Validation: routing test per locale + browser hreflang.", parallelLane: "i18n",
        effort: "S", deps: "I.1,B.2" },
    ],
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const adapter = new PrismaNeon({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  let groupsInserted = 0, groupsUpdated = 0;
  let tasksInserted = 0, tasksUpdated = 0, tasksUnchanged = 0;

  for (const g of GROUPS) {
    const existingG = await prisma.taskGroup.findUnique({ where: { id: g.id } });
    if (!existingG) {
      await prisma.taskGroup.create({
        data: { id: g.id, name: g.name, description: g.description, domain: g.domain, sortOrder: g.sortOrder },
      });
      groupsInserted++;
    } else {
      await prisma.taskGroup.update({
        where: { id: g.id },
        data: { name: g.name, description: g.description, domain: g.domain, sortOrder: g.sortOrder },
      });
      groupsUpdated++;
    }

    for (let i = 0; i < g.tasks.length; i++) {
      const t = g.tasks[i];
      const existing = await prisma.task.findUnique({ where: { id: t.id } });
      const isHumanRequired = t.tags?.includes("human-required");
      const status = (t.status ?? (isHumanRequired ? "HUMAN_REQUIRED" : "PENDING")) as TaskStatus;

      if (!existing) {
        await prisma.task.create({
          data: {
            id: t.id,
            groupId: g.id,
            title: t.title,
            description: t.description,
            effort: t.effort,
            status,
            priority: t.priority ?? 50,
            deps: t.deps ?? null,
            tags: t.tags ?? null,
            sortOrder: i,
            completedAt: status === "DONE" ? new Date() : null,
          },
        });
        tasksInserted++;
      } else {
        const becameNewlyDone = existing.status !== "DONE" && status === "DONE";
        await prisma.task.update({
          where: { id: t.id },
          data: {
            groupId: g.id,
            title: t.title,
            description: t.description,
            effort: t.effort,
            status,
            priority: t.priority ?? existing.priority,
            deps: t.deps ?? existing.deps,
            tags: t.tags ?? existing.tags,
            sortOrder: i,
            completedAt: becameNewlyDone ? new Date() : (status === "DONE" ? existing.completedAt : null),
          },
        });
        tasksUpdated++;
      }
    }
  }

  const groupCount = await prisma.taskGroup.count();
  const taskCount = await prisma.task.count();
  console.log(`groups · inserted ${groupsInserted} · updated ${groupsUpdated}`);
  console.log(`tasks  · inserted ${tasksInserted} · updated ${tasksUpdated}`);
  console.log(`total · ${groupCount} groups · ${taskCount} tasks`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
