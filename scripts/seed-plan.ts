// Idempotent seed for the domain-restructured task tracker.
// Builds 9 TaskGroups + ~80 tasks with rich descriptions.
// Preserves per-task state (scores, PR links, sessions) on re-seed.
//
// Run via: pnpm seed:plan

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
  priority?: number;
}

const GROUPS: SeedGroup[] = [
  {
    id: "A",
    name: "Foundation",
    description:
      "Infrastructure, schema, auth, dev tooling. Almost entirely shipped already.",
    domain: "FOUNDATION",
    sortOrder: 0,
    tasks: [
      {
        id: "A.1",
        title: "Next.js 16 + Prisma 7 + Tailwind 4 + NextAuth scaffold",
        description:
          "Initialize the repo with the stack pinned in CLAUDE.md. Strict TypeScript, ESLint flat config, Prettier, vitest with --passWithNoTests, prisma generate via postinstall, lazy PrismaClient via Proxy.",
        effort: "M",
        status: "DONE",
      },
      {
        id: "A.2",
        title: "Prisma schema for the full data model",
        description:
          "All 19+ models: User, Account, Session, Agency, AgencyMember, Business, BusinessSnapshot, Review, LighthouseAudit, AdLibraryEntry, Keyword, SerpResult, List, ListRefresh, Lead, Report, CronRun, Task, TaskGroup, TaskRun. With composite indexes from scalability.md.",
        effort: "M",
        status: "DONE",
      },
      {
        id: "A.3",
        title: "Neon Postgres + DB push",
        description:
          "Wire Neon serverless adapter via @prisma/adapter-neon. Push schema. Verify 19 tables + 48+ indexes materialized.",
        effort: "S",
        status: "DONE",
      },
      {
        id: "A.4",
        title: "GitHub Actions CI · validate · build · test",
        description:
          "Workflow at .github/workflows/ci.yml. Format-check + typecheck + lint + build + test:run + ci-passed gate job. Required for auto-merge.",
        effort: "S",
        status: "DONE",
      },
      {
        id: "A.5",
        title: "Auto-merge workflow + autonomous-ready label",
        description:
          ".github/workflows/auto-merge.yml fires on autonomous-ready label + branch starting auto/ or enhance/. gh pr merge --squash --auto --delete-branch.",
        effort: "S",
        status: "DONE",
      },
      {
        id: "A.6",
        title: "Vercel deploy · mapsly.ai · dev.mapsly.ai",
        description:
          "Production domain wired to www.mapsly.ai. Subdomain dev.mapsly.ai via DNS CNAME → Vercel. Middleware host-based rewrite to /dev. Env vars in Vercel project. Postinstall runs prisma generate.",
        effort: "S",
        status: "DONE",
      },
      {
        id: "A.7",
        title: "Incident-prevention system",
        description:
          ".claude/memory/incidents.md seeded with 14 real incidents. .claude/rules/incident-prevention.md as load-bearing rule. autonomous-build-loop SKILL mandates incidents read first + new entries before close.",
        effort: "M",
        status: "DONE",
      },
      {
        id: "A.8",
        title: "Native macOS launchd loop",
        description:
          "scripts/launchd/ — wrapper + plist + installer. Escapes Cowork FUSE limitation. Runs every 5 min via launchd. Loop reads lock state; can pause/resume from dashboard.",
        effort: "M",
        status: "DONE",
      },
    ],
  },
  {
    id: "B",
    name: "Marketing surface (public)",
    description:
      "Pages anyone can see: landing, for-SMB, for-Agency, pricing, sign-in. Drives signups.",
    domain: "MARKETING",
    sortOrder: 1,
    tasks: [
      {
        id: "B.1",
        title: "Main landing · mapsly.ai/",
        description:
          "Hero · 8-block landing per _design/landing/index.html. Audience switcher (SMB ↔ Agency). For each: outcome-first hero, social proof, signal vocabulary teaser, CTAs. Cream/coral palette for SMB section, cool-gray/indigo for Agency section.",
        effort: "L",
        deps: "A.1",
        tags: "marketing,smb,agency",
      },
      {
        id: "B.2",
        title: "For-Agencies landing · /for-agencies",
        description:
          "Agency-targeted variant. Tom's voice (jargon-OK). Lists 60+ signals as moat. Plan tiers ($49 / $99 / $249 / $499). Sample-list preview. Calculator: 'how many qualified leads in your metro?'",
        effort: "L",
        deps: "A.1",
        tags: "marketing,agency",
      },
      {
        id: "B.3",
        title: "For-SMB landing · /for-smb (or /for-businesses)",
        description:
          "Maria's voice (plain English, no jargon). 'See what's wrong with your spa this week — for $29/mo.' Outcome-first KPIs, simple onboarding promise.",
        effort: "M",
        deps: "A.1",
        tags: "marketing,smb",
      },
      {
        id: "B.4",
        title: "Pricing page · /pricing",
        description:
          "SMB single tier ($29) + 4 agency tiers. Comparison table. FAQ. Trust badges. Stripe-checkout CTA.",
        effort: "M",
        deps: "B.1",
        tags: "marketing,billing",
      },
      {
        id: "B.5",
        title: "Public business profile · /biz/[slug]",
        description:
          "SEO-targeted landing for indexed businesses. Mapsly Score visible (anonymously). Markets a 'claim this business' flow to the SMB. Schema.org LocalBusiness + AggregateRating.",
        effort: "L",
        deps: "C.6,D.1",
        tags: "marketing,seo",
      },
      {
        id: "B.6",
        title: "Sign-in flow · /signin + /signin/check-email",
        description:
          "NextAuth v5 magic link via Resend. Email-first, no password. Branded check-email page. Audience routing post-login.",
        effort: "S",
        deps: "A.3",
        tags: "auth",
      },
      {
        id: "B.7",
        title: "SEO infrastructure · sitemap + hreflang + structured data",
        description:
          "app/sitemap.ts splits at 50K URLs. app/robots.ts. hreflang on every public page. JSON-LD per page type. Open Graph 1200x630.",
        effort: "M",
        deps: "B.1",
        tags: "seo",
      },
      {
        id: "B.8",
        title: "Marketing copy in 4 locales (en-US, es-US, en-CA, fr-CA)",
        description:
          "messages/{locale}.json for marketing namespace. Human-translated (no MT). Locale switcher in header. Auto-detect on first visit, cookie-persist.",
        effort: "L",
        deps: "B.1,I.1",
        tags: "marketing,i18n",
      },
    ],
  },
  {
    id: "C",
    name: "Data collection layer",
    description:
      "External APIs, cron jobs, cost tracking. Populates the 2.1M business index.",
    domain: "DATA",
    sortOrder: 2,
    tasks: [
      {
        id: "C.1",
        title: "Cost-counter + CronRun lifecycle",
        description:
          "lib/cost/cost-counter.ts uses AsyncLocalStorage to bind a CronRun to all external calls. Increments costUsd on every adapter call. Throws if no open CronRun (enforces 'no live API in user request path').",
        effort: "S",
        deps: "A.2",
      },
      {
        id: "C.2",
        title: "Cache layer · Redis/KV backed · 24h TTL",
        description:
          "lib/cache/index.ts. Key format: {vendor}:{operation}:{stable-hash}. Cache hits tracked in CronRun.meta.cacheHits. Falls through gracefully if Redis unavailable.",
        effort: "S",
        deps: "C.1",
        tags: "phase-2",
      },
      {
        id: "C.3",
        title: "services/dataforseo · all adapters",
        description:
          "Maps SERP, Local Pack, SERP organic, Reviews, Keyword Volume, Lighthouse. Each wrapped with cost-counter + 24h cache + retry (max 2). Uses DataForSEO Standard queue (10x cheaper than Live).",
        effort: "XL",
        deps: "C.1,C.2",
      },
      {
        id: "C.4",
        title: "services/meta-ad-library",
        description:
          "ads_archive endpoint. Daily competitor ad scan. Cost-tracked. Cache 6h.",
        effort: "M",
        deps: "C.1,C.2",
      },
      {
        id: "C.5",
        title: "services/lighthouse · DataForSEO + DOM checks",
        description:
          "Wraps DataForSEO Lighthouse plus custom DOM: schema markup presence, NAP consistency, booking CTA detection.",
        effort: "M",
        deps: "C.3",
      },
      {
        id: "C.6",
        title: "services/email-verify · SMTP verification",
        description:
          "Phase 2: verify SMB/agency contact emails are deliverable. Used for cohort outreach + onboarding email validity.",
        effort: "S",
      },
      {
        id: "C.7",
        title: "services/ai-haiku · Anthropic wrapper",
        description:
          "Wraps the Anthropic SDK for review sentiment + reply drafts + one-pager copy. Cost-tracked. Cheaper model where possible.",
        effort: "S",
        deps: "C.1",
      },
      {
        id: "C.8",
        title: "Cron · daily handlers (6)",
        description:
          "/api/cron/daily/{brand-hijack-scan, ad-library-diff, new-reviews-delta, indexer-new-businesses, list-refresh-daily, google-ads-transparency}. Each opens CronRun, processes a batch, closes CronRun. Vercel cron schedule.",
        effort: "L",
        deps: "C.3,C.4",
      },
      {
        id: "C.9",
        title: "Cron · weekly handlers (7)",
        description:
          "Weekly: business-profile-refresh, reviews-full-pull (+sentiment+AI replies), serp-rank-scan, lighthouse-audit, competitor-diff, snapshot-write (Mapsly Score + MSI compute), list-refresh-weekly.",
        effort: "XL",
        deps: "C.3,C.5,D.1",
      },
      {
        id: "C.10",
        title: "Cron · monthly handlers (4)",
        description:
          "keyword-volume-refresh, market-census, industry-baseline, email-verification. Slow data; budget-heavy.",
        effort: "L",
        deps: "C.3",
      },
    ],
  },
  {
    id: "D",
    name: "Compute / scoring",
    description:
      "The 60+ signal vocabulary, scoring formulas, AI classification. Mapsly's moat.",
    domain: "COMPUTE",
    sortOrder: 3,
    tasks: [
      {
        id: "D.1",
        title: "Signal registry · 60+ filterable signals",
        description:
          "modules/signals/registry.ts. Canonical definition for every signal: source, storage, refresh cadence, comparators, default value, tooltip. Hunter UI + Prospect view read from this.",
        effort: "L",
        deps: "C.9",
        tags: "signals,moat",
      },
      {
        id: "D.2",
        title: "Mapsly Score formula",
        description:
          "modules/scoring/mapsly-score.ts. 6-dim weighted composite (reputation 25, communication 15, profile 15, trust 15, pricing 15, brand 15). Clamped 0-10. Unit tested.",
        effort: "M",
        deps: "D.1",
      },
      {
        id: "D.3",
        title: "Market Share Index (MSI) rank computation",
        description:
          "Within-metro ranking by Mapsly Score, weighted by review volume + ad spend visibility. Runs in snapshot-write cron.",
        effort: "M",
        deps: "D.2",
      },
      {
        id: "D.4",
        title: "Hunter filter evaluation engine",
        description:
          "modules/hunter/evaluate.ts. Takes a filter spec (signals + comparators + values) → returns matching Business IDs. Optimized for incremental refresh (changed-rows-only).",
        effort: "L",
        deps: "D.1",
      },
      {
        id: "D.5",
        title: "Match score · per-lead per-list ranking",
        description:
          "modules/scoring/match-score.ts. Within a list, rank leads by how strongly they match the filter signals. Surfaced as 'why this lead' in Prospect view.",
        effort: "M",
        deps: "D.4",
      },
      {
        id: "D.6",
        title: "AI sentiment + theme extraction for reviews",
        description:
          "ai-haiku call per review. Sentiment POS/NEU/NEG. Theme tags (atmosphere, price, staff, parking, etc.). Stored on Review.themes[]. Used in SMB reviews page + competitor diff.",
        effort: "M",
        deps: "C.7,C.9",
      },
      {
        id: "D.7",
        title: "AI reply draft generation (EN + ES)",
        description:
          "On every new review, generate aiReplyDraftEn + aiReplyDraftEs. Branded tone matching the SMB's reply-tone setting. Stored on Review row.",
        effort: "M",
        deps: "C.7",
      },
    ],
  },
  {
    id: "E",
    name: "SMB portal · Maria's pages",
    description:
      "Warm + simple. Patients/treatments vocabulary. One CTA per screen. Mobile-first.",
    domain: "SMB_PORTAL",
    sortOrder: 4,
    tasks: [
      {
        id: "E.1",
        title: "SMB dashboard · /(smb)/dashboard",
        description:
          "Hero KPI: Mapsly Score 6.2/10. 5 supporting KPI tiles. 'What needs your attention today' (max 4 alert cards). Top 3 fixes ordered by impact. This-week activity feed.",
        effort: "L",
        deps: "D.2,C.9",
      },
      {
        id: "E.2",
        title: "SMB reviews page · /(smb)/reviews",
        description:
          "Tabs: Unanswered (default) / Negative / All / By theme. Each review card: stars + date + text + AI reply draft (EN+ES toggle). 'Post to Google' CTA. Right rail: rating distribution, theme analysis, reply-tone settings.",
        effort: "L",
        deps: "D.6,D.7",
      },
      {
        id: "E.3",
        title: "SMB competitors page · /(smb)/competitors",
        description:
          "Head-to-head comparison vs 3 nearest competitors. Service coverage matrix. Threat ranking. 'Where you beat them' / 'Where they beat you' wedges.",
        effort: "L",
        deps: "C.9",
      },
      {
        id: "E.4",
        title: "SMB search visibility · /(smb)/search",
        description:
          "Keyword table: term, monthly volume, your position, who else ranks in local 3-pack. P0 opportunities (high volume + low your-rank). Plain-English explainer: 'When someone searches X you appear Y'.",
        effort: "M",
        deps: "C.9",
      },
      {
        id: "E.5",
        title: "SMB ads page · /(smb)/ads",
        description:
          "Competitor ad copy by keyword (Meta + Google Ads Transparency). 'Off-keyword warning' for ads that don't match the SMB's services. 14-keyword lane grid.",
        effort: "M",
        deps: "C.4,C.8",
      },
      {
        id: "E.6",
        title: "SMB settings · /(smb)/settings",
        description:
          "Business info (name, address, hours, services). Reply-tone (warm / professional / casual). Locale preference. Notification preferences. Stripe billing card.",
        effort: "M",
        deps: "B.6",
      },
      {
        id: "E.7",
        title: "SMB onboarding flow",
        description:
          "4-step wizard: claim business → set vocabulary (industry) → connect Google Business Profile → invite team. Each step has a skip option, mobile-friendly.",
        effort: "L",
        deps: "B.6",
      },
    ],
  },
  {
    id: "F",
    name: "Agency portal · Tom's pages",
    description:
      "Tool-y + dense. Local 3-pack / LCP / MSI jargon OK. Keyboard shortcuts. Bulk actions.",
    domain: "AGENCY_PORTAL",
    sortOrder: 5,
    tasks: [
      {
        id: "F.1",
        title: "Agency lists · /(agency)/lists",
        description:
          "Service-template strip at top (Website / Meta ads / Local SEO / etc.). Today's-new-matches summary row. Lists grid · service badge per card · hover-reveal actions (clone, pause, more). Paused section below.",
        effort: "L",
        deps: "D.4",
      },
      {
        id: "F.2",
        title: "Hunter UI · /(agency)/search",
        description:
          "3-step flow: pick service template → target market (category, geo, radius) → tune filters. 60+ editable filter rows (comparator dropdown + value input). Sticky preview bar: live match count + filter summary + 'Save as list'.",
        effort: "XL",
        deps: "D.1,D.4",
        tags: "hunter,moat",
      },
      {
        id: "F.3",
        title: "List detail · /(agency)/lists/[id]",
        description:
          "Hero: pitch + 5 KPIs. Filter chips bar. Status tabs: New / Contacted / Replied / Won / Lost / Hidden. Table rows: business, why-qualified signals, status pill, contact, action. Sticky bulk-action bar.",
        effort: "L",
        deps: "F.1",
      },
      {
        id: "F.4",
        title: "Prospect detail · /(agency)/prospect/[businessId]",
        description:
          "Hero: avatar, name, address, prev/next nav, Mark Contacted, Mark Client, Generate one-pager. Top stats row (6 KPIs). 'Why this lead qualifies' — 4 numbered pitch wedges with evidence footers. Signal blocks: Reviews / Competitors / Search / Ads / Website.",
        effort: "XL",
        deps: "D.5,F.3",
      },
      {
        id: "F.5",
        title: "List analytics · /(agency)/list-analytics",
        description:
          "4-stat header (surfaced 90d / contact rate / reply rate / closed won). Per-list table with mini-funnel viz per row. Signal correlation panel (which signals predict replies).",
        effort: "M",
        deps: "F.3",
      },
      {
        id: "F.6",
        title: "One-pager PDF generation",
        description:
          "Generate per-prospect PDF with Solea-template branding. Headline insight, 4 pitch wedges, evidence sections. Write to Vercel Blob, return signed URL.",
        effort: "L",
        deps: "F.4",
      },
      {
        id: "F.7",
        title: "CSV export · with column picker",
        description:
          "Per-list CSV download. User chooses columns (business name, address, phone, score, status, etc.). Writes to Vercel Blob, signed URL, 30d expiry.",
        effort: "S",
        deps: "F.3",
      },
      {
        id: "F.8",
        title: "Shareable link · /share/[publicShareId]",
        description:
          "Read-only public route showing one-pager content. Branded with agency name + logo. 30d expiry. View counter. Auto-noindex.",
        effort: "M",
        deps: "F.6",
      },
      {
        id: "F.9",
        title: "Agency settings · /(agency)/settings",
        description:
          "Team management (invite/remove members). Default metro + categories. Billing (current plan, change tier, invoices). API keys section (future).",
        effort: "M",
        deps: "B.6",
      },
      {
        id: "F.10",
        title: "Agency onboarding flow",
        description:
          "3-step: agency profile → choose first service template → see first 50 free leads. Skips allowed. Drops into lists view at end.",
        effort: "M",
        deps: "B.6,F.1",
      },
      {
        id: "F.11",
        title: "Global search bar · ⌘K business lookup",
        description:
          "Top-bar quick-search. Type business name or URL → fuzzy match. Click → open Prospect detail. Keyboard-driven.",
        effort: "S",
        deps: "C.8,F.4",
      },
    ],
  },
  {
    id: "G",
    name: "Billing",
    description: "Stripe checkout, subscriptions, tier enforcement.",
    domain: "BILLING",
    sortOrder: 6,
    tasks: [
      {
        id: "G.1",
        title: "Stripe checkout · subscription create",
        description:
          "5 price IDs (SMB $29 + 4 agency tiers). Checkout session creator. Stripe Customer creation, link to User/Agency.",
        effort: "M",
        deps: "B.6",
      },
      {
        id: "G.2",
        title: "Stripe webhook · subscription lifecycle (idempotent)",
        description:
          "/api/webhooks/stripe. Verify signature. Idempotency via StripeWebhookEvent table. Handle: checkout.completed, invoice.paid, subscription.updated, subscription.deleted.",
        effort: "M",
        deps: "G.1",
      },
      {
        id: "G.3",
        title: "Tier enforcement · cost ceilings + feature gating",
        description:
          "lib/cost/tier-ceiling.ts. Per-tier monthly API cost cap. Cron jobs skip business if ceiling reached. Agency features gated by plan (e.g., Boutique unlocks shareable links, Solo doesn't).",
        effort: "M",
        deps: "G.2,C.1",
      },
      {
        id: "G.4",
        title: "Billing UI · current plan + invoices + change tier",
        description:
          "Embedded in Agency settings + SMB settings. Show current plan, days remaining, last invoice link (Stripe-hosted). Change tier → Stripe customer portal session.",
        effort: "M",
        deps: "G.1",
      },
    ],
  },
  {
    id: "H",
    name: "Ops · self-improvement infrastructure",
    description:
      "Internal tooling: dev dashboard, task tracker (this!), incident system, process-enhancer.",
    domain: "OPS",
    sortOrder: 7,
    tasks: [
      {
        id: "H.1",
        title: "dev.mapsly.ai dashboard · core",
        description:
          "Hero tiles (open PRs, merges 7d, avg score, cost today, plan %, blockers). Cards: Loop control, Plan progress, Sessions 7d, External service health, Cron+API health, Auto-enhance signals, Recent commits, Open PRs. Refresh button + 30s AutoRefresh.",
        effort: "XL",
        deps: "A.6",
        status: "DONE",
      },
      {
        id: "H.2",
        title: "Task tracker · DB-backed with TaskGroup + TaskRun models",
        description:
          "Postgres Task + TaskGroup + TaskRun tables. Seed from this file. Dashboard reads from DB. /dev/tasks list grouped by domain phase. (THIS task.)",
        effort: "L",
        deps: "A.2",
        status: "IN_PROGRESS",
      },
      {
        id: "H.3",
        title: "/dev/tasks/[id] detail page with edit + run history",
        description:
          "Per-task page showing all fields editable. Run history table (TaskRun rows). Per-run scorecard, agents/skills used, rules consulted, PR + commit links, quality gate badges, incidents logged.",
        effort: "L",
        deps: "H.2",
      },
      {
        id: "H.4",
        title: "Edit + Add + Delete tasks from UI",
        description:
          "Server actions backed by Prisma. Inline edit on list view (status, title). Full edit on detail page. New-task modal (group, title, description, effort, deps, tags). Soft-delete (status: SKIPPED).",
        effort: "M",
        deps: "H.3",
      },
      {
        id: "H.5",
        title: "Loop reads next task from DB (not PLAN.md)",
        description:
          "Update scripts/launchd/loop-prompt.md so the loop queries Task table: status=PENDING, deps satisfied, not human-required, priority ascending, sortOrder ascending. On claim, status=IN_PROGRESS, lastSessionId=current. On close, write TaskRun + bump Task.status.",
        effort: "M",
        deps: "H.2",
      },
      {
        id: "H.6",
        title: "process-enhancer agent · meta-loop",
        description:
          "Daily scheduled agent. Reads incidents.md + last-N TaskRun rows + sessions JSON. Clusters patterns. Opens self-improvement PRs (rule rewrites, agent prompt tweaks). Writes enhance-signals.json for dashboard rendering.",
        effort: "L",
        deps: "H.2",
      },
      {
        id: "H.7",
        title: "Quality gates panel per TaskRun",
        description:
          "Show: CI badge (green/red), Vercel deploy result, Lighthouse score, code-reviewer verdict, test-writer added (N) tests, performance-auditor LCP/CLS/INP, ux-reviewer-{audience} pass/fail, copy-reviewer pass/fail, scorer 5-dim card.",
        effort: "M",
        deps: "H.3",
      },
    ],
  },
  {
    id: "I",
    name: "i18n · 4 locales",
    description:
      "en-US default, es-US (Spanish US), en-CA (Canadian English), fr-CA (Quebec French).",
    domain: "I18N",
    sortOrder: 8,
    tasks: [
      {
        id: "I.1",
        title: "next-intl scaffold · app/[locale]/ tree",
        description:
          "i18n/routing.ts with defineRouting. messages/{en,es,en-CA,fr}.json. Locale switcher. Auto-detect via Accept-Language. Cookie persistence.",
        effort: "M",
        deps: "A.1",
        status: "DONE",
      },
      {
        id: "I.2",
        title: "Spanish (es-US) translation of marketing copy",
        description:
          "messages/es.json populated for marketing namespace. Native-speaker review (no MT). Service vocabulary (patients → pacientes for med-spa).",
        effort: "M",
        deps: "I.1,B.1",
        tags: "human-required",
      },
      {
        id: "I.3",
        title: "Quebec French (fr-CA) translation",
        description:
          "messages/fr.json. Native Quebec French reviewer. CAD currency formatting. Locale-specific date formats.",
        effort: "M",
        deps: "I.1,B.1",
        tags: "human-required",
      },
      {
        id: "I.4",
        title: "Canadian English (en-CA) overrides",
        description:
          "messages/en-CA.json with only overrides vs en (cheque vs check, neighbour, etc.). Fallback chain to en.",
        effort: "S",
        deps: "I.1",
      },
      {
        id: "I.5",
        title: "Currency + date locale-aware formatting",
        description:
          "useFormatter() throughout. en-US: $29.99 May 17. fr-CA: 29,99 $ CA 17 mai. Each Price + Date component reads locale.",
        effort: "S",
        deps: "I.1",
      },
      {
        id: "I.6",
        title: "Translated route pathnames",
        description:
          "Per routing.ts pathnames: /for-agencies → /para-agencias / /pour-agences. /lists → /listas / /listes. Link component from next-intl handles routing.",
        effort: "S",
        deps: "I.1,B.2",
      },
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

  let groupsInserted = 0;
  let groupsUpdated = 0;
  let tasksInserted = 0;
  let tasksUpdated = 0;

  for (const g of GROUPS) {
    const existingG = await prisma.taskGroup.findUnique({
      where: { id: g.id },
    });
    if (!existingG) {
      await prisma.taskGroup.create({
        data: {
          id: g.id,
          name: g.name,
          description: g.description,
          domain: g.domain,
          sortOrder: g.sortOrder,
        },
      });
      groupsInserted++;
    } else {
      await prisma.taskGroup.update({
        where: { id: g.id },
        data: {
          name: g.name,
          description: g.description,
          domain: g.domain,
          sortOrder: g.sortOrder,
        },
      });
      groupsUpdated++;
    }

    for (let i = 0; i < g.tasks.length; i++) {
      const t = g.tasks[i];
      const existing = await prisma.task.findUnique({ where: { id: t.id } });
      const isHumanRequired = t.tags?.includes("human-required");
      const status = (t.status ??
        (isHumanRequired ? "HUMAN_REQUIRED" : "PENDING")) as TaskStatus;
      const becameNewlyDone =
        existing && existing.status !== "DONE" && status === "DONE";

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
            completedAt: becameNewlyDone
              ? new Date()
              : status === "DONE"
                ? existing.completedAt
                : null,
          },
        });
        tasksUpdated++;
      }
    }
  }

  const taskCount = await prisma.task.count();
  const groupCount = await prisma.taskGroup.count();

  console.log(`groups · inserted ${groupsInserted} · updated ${groupsUpdated}`);
  console.log(`tasks  · inserted ${tasksInserted} · updated ${tasksUpdated}`);
  console.log(`total · ${groupCount} groups · ${taskCount} tasks`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
