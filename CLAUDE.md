# Mapsly · CLAUDE.md

Project-level rules. Loaded automatically by Claude Code on every session.

> **Performance is the #1 product requirement.** Every page · every route · every interaction. Slow = broken. See `.claude/rules/performance.md`.

> **All autonomous development runs on Claude Pro Max 20x via `/loop` in an open Claude Code session · NEVER the OpenAI API.** Use the entire 5h token budget per session — the plan is paid, idle quota is wasted. The canonical scheduler is `/loop 5m` reading `.claude/loop.md`; launchd is kept as a fallback. See `.claude/skills/autonomous-build-loop/SKILL.md`, `.claude/loop.md`, and `docs/permissions.md`.

> **Model pin · always the latest Opus, always max effort.** The launchd wrapper sets `--model "$CLAUDE_MODEL"` (default `claude-opus-4-7`; 1M context auto-enabled on Pro Max) and `--effort "$CLAUDE_EFFORT_LEVEL"` (default `max`). Both overridable via `.env.local`. Plus `--dangerously-skip-permissions` is required in headless mode — see INC-19. Bump model as new releases ship. Sonnet is faster but lower-quality for orchestration; Haiku is too small for the agent-spawning logic. Opus + max effort is required for the loop's quality bar — session budget is the cap, not per-call cost, so we want the deepest reasoning per tick.

> **Auto-merge is default.** When all gates pass, the loop merges itself to `main`. Viktor watches via `dev.mapsly.ai` and daily GitHub digest, not per-PR review. See `docs/dev-dashboard.md`.

---

## Product context

**Mapsly** is a signal-driven local-business-intelligence platform. Two audiences. Two portals. Two distinct UX languages.

|                     | SMB                                                                | Agency                                                 |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| Persona             | Maria · owner of one local business                                | Tom · owner of a 4-seat marketing agency               |
| Job                 | "Make MY business better"                                          | "Find qualified prospects for my pitch"                |
| Vocabulary          | "patients · treatments · providers"                                | "MSI · 3-pack · LCP · schema · NAP · GBP"              |
| Pricing             | $29/mo direct                                                      | $49 Solo · $99 Growth · $249 Pro · $499 Boutique       |
| Palette             | Warm cream + coral (`#faf6f1` / `#c3553a`)                         | Cool gray + indigo (`#f6f7fb` / `#5b3df5`)             |
| UX language         | Warm, plain English, mobile-first, big numbers, one CTA per screen | Tool-y, dense, keyboard-first, bulk actions, jargon-OK |
| Information density | Below-the-fold beyond 4 KPIs                                       | Above-the-fold dense workflows                         |
| Reference rules     | `.claude/rules/ui-ux-smb.md`                                       | `.claude/rules/ui-ux-agency.md`                        |

**Every agent that touches UI MUST read the relevant audience rule before producing copy or layout.**

**Strategy:** signal vocabulary (60+ filters across reputation, search, ads, website, profile, competitive, business qualifiers) is the moat. Apollo / ZoomInfo can't tell you a prospect's site loads slow + reply rate is 0% + a competitor moved into their building.

---

## Stack

| Tech                | Version | Notes                                        |
| ------------------- | ------- | -------------------------------------------- |
| Node.js             | 24      | `.nvmrc` pins to `24`                        |
| Next.js             | 16      | Turbopack default, PPR via `cacheComponents` |
| React               | 19      | `react-jsx`, `use cache`, `useOptimistic`    |
| Prisma              | 7       | Neon serverless adapter                      |
| TypeScript          | 5       | Strict; ES2022 target                        |
| Tailwind            | 4       | `@tailwindcss/postcss`, `inlineCss`          |
| NextAuth            | 5-beta  | JWT, magic link via Resend                   |
| next-intl           | 4       | en · es · en-CA · fr-CA                      |
| TanStack Query      | 5       | client-side caching                          |
| Vitest + Playwright | latest  | testing                                      |

---

## The rules · loaded automatically

Every TS/TSX file you touch loads the relevant rule docs as context. Read them before writing code.

### Always loaded (every change)

- **`.claude/rules/incident-prevention.md` — read `.claude/memory/incidents.md` first; encode new failures**
- `.claude/rules/conventions.md` — naming · structure · imports
- `.claude/rules/git-discipline.md` — branches · commits · force-push · author identity
- `.claude/rules/observability.md` — Sentry tags · logging · correlation IDs · post-merge health check
- `.claude/rules/performance.md` — the #1 priority
- `.claude/rules/caching.md` — tag everything
- `.claude/rules/scalability.md` — indexes · batching · rate limits
- `.claude/rules/security.md` — auth · CSRF · CSP · webhook verify
- `.claude/rules/validation-and-errors.md` — Zod everywhere · error shapes
- `.claude/rules/copy-voice.md` — voice per audience
- `.claude/rules/cost-discipline.md` — every API call costs money

### Loaded conditionally

- `.claude/rules/data-fetching.md` — when SSR/SSG/streaming/server-action/SSE
- `.claude/rules/realtime-and-optimistic.md` — useOptimistic · SSE patterns
- `.claude/rules/seo.md` — marketing/blog/public pages
- `.claude/rules/accessibility.md` — WCAG 2.1 AA
- `.claude/rules/browser-testing.md` — every UI phase validated via Claude in Chrome before merge
- `.claude/rules/validation.md` — loop decides per-task: unit/integration/browser/DB/email/perf/a11y · records strategy + outcomes
- `.claude/rules/versioning.md` — every auto-merge bumps package.json patch; phase close bumps minor
- `.claude/rules/i18n.md` — translations
- `.claude/rules/testing.md` — what to test, what NOT to test
- `.claude/rules/signal-engineering.md` — when adding/changing signals
- `.claude/rules/ui-ux-smb.md` — `/(smb)/` routes
- `.claude/rules/ui-ux-agency.md` — `/(agency)/` routes
- `.claude/rules/mcp-postgres.md` — when querying via MCP
- `.claude/rules/mcp-dataforseo.md` — when calling DataForSEO

---

## Orchestrator pattern

You ARE the orchestrator. Every non-trivial request goes through:

1. **Show the flow + launch research agents in parallel** in the SAME message. All agents `run_in_background: true`. User sees only the flow.
2. **Synthesize.** Combine into a Score Card (1–10 per dimension) + Comparison Table + Recommendations + Phased Plan (one phase = one session).
3. **Implement only after approval (or autonomously inside the loop).** After every implementation phase, auto-spawn the appropriate review agents:
   - `code-reviewer` (always)
   - `test-writer` (if logic-heavy)
   - `performance-auditor` (if route/page changed)
   - `ux-reviewer-smb` (if `/(smb)/` touched)
   - `ux-reviewer-agency` (if `/(agency)/` touched)
   - `copy-reviewer` (if user-visible copy changed)
4. **Score.** Spawn the `scorer` agent on the completed phase. Produces 5-dim scorecard (Completion · Quality · Audience-fit · Relevance · Performance). Append to PLAN.md.
5. **Auto-merge or hold.** If aggregate ≥ 9.0 AND min cell ≥ 8.0 AND deploy-check passed AND CI green AND no new Sentry errors → **auto-merge to main**. Else → tag PR `needs-review`, leave for Viktor.
6. **Iterate.** Pick next task. Loop until token budget low or time exhausted.

**Auto-merge means `mapsly.ai` always reflects latest autonomous code.** Viktor reviews already-shipped code via `dev.mapsly.ai` dashboard + daily GitHub digest email. Quality gates do the gatekeeping.

**Always recommend, never ask.** Research yourself. Present with reasoning.

**Scale to complexity.** Typo fix doesn't need 5 agents. Match the depth to the scope.

---

## Folder layout

```
app/                                # Next.js routes
  [locale]/                         # i18n root: en, es, en-CA, fr
    (marketing)/                    # public landing
    (smb)/                          # Maria's portal · cream + coral
    (agency)/                       # Tom's portal · cool gray + indigo
  api/
    cron/{daily,weekly,monthly}/    # 17 cron handlers
    webhooks/{stripe,resend}/
    realtime/                       # SSE endpoints
modules/                            # feature modules (boundary = folder)
  hunter/                           # agency search engine
  lists/                            # agency lists + list-detail
  prospect/                         # single-lead deep view
  reports/                          # one-pagers, CSVs, share links
  reviews/                          # SMB review reply flow
  signals/                          # the 60+ signal registry
  scoring/                          # Mapsly Score, MSI, match score
  billing/                          # Stripe integration
  auth/                             # NextAuth wrappers
services/                           # external API adapters · cost-tracked
  dataforseo/  meta-ad-library/  lighthouse/  email-verify/  ai-openai/
lib/
  prisma.ts  prisma-types.ts  auth.ts
  cost/cost-counter.ts              # AsyncLocalStorage cost tracking
  cache/                            # KV + Next cache helpers
  middleware/                       # rate-limit · no-live-api · etc.
i18n/
  routing.ts  request.ts            # next-intl config
messages/
  en.json  es.json  en-CA.json  fr.json
prisma/
  schema.prisma  migrations/  seed.ts
docs/
  data-cadence.md                   # daily/weekly/monthly + cost ceiling
  handoff.md                        # manual setup checklist
  autonomous-build-setup.md         # Claude scheduled task setup
  permissions.md                    # what Claude can/can't do · $5 rule
_design/                            # original HTML mockups (reference)
.claude/                            # agents · rules · skills · memory
  agents/  rules/  skills/  memory/
```

---

## Feature map (live)

| Feature                | Module                | Routes                                           | Status   |
| ---------------------- | --------------------- | ------------------------------------------------ | -------- |
| Landing (SMB)          | —                     | `app/[locale]/(marketing)/page.tsx`              | scaffold |
| Landing (Agency)       | —                     | `app/[locale]/(marketing)/for-agencies/page.tsx` | scaffold |
| SMB dashboard          | modules/smb-dashboard | `app/[locale]/(smb)/dashboard`                   | pending  |
| SMB reviews            | modules/reviews       | `app/[locale]/(smb)/reviews`                     | pending  |
| Agency lists           | modules/lists         | `app/[locale]/(agency)/lists`                    | pending  |
| Agency search (hunter) | modules/hunter        | `app/[locale]/(agency)/search`                   | pending  |
| Prospect detail        | modules/prospect      | `app/[locale]/(agency)/prospect/[id]`            | pending  |
| Reports (CSV/PDF/link) | modules/reports       | `app/[locale]/(agency)/reports`                  | pending  |
| Cron jobs              | —                     | `app/api/cron/**`                                | pending  |
| Stripe                 | modules/billing       | `app/api/webhooks/stripe`                        | pending  |
| Auth                   | modules/auth          | NextAuth handlers                                | pending  |
| i18n                   | —                     | next-intl + middleware                           | scaffold |

See `PLAN.md` for phased priorities.

---

## Conventions (high level — full detail in `.claude/rules/conventions.md`)

- **Prisma imports:** server → `@/lib/prisma`. Client / types → `@/lib/prisma-types`. Scripts → `@/lib/prisma-script`. Never bare `@/lib/generated/prisma`.
- **No live API in user request path.** Cron only. Enforced by `lib/middleware/no-live-api.ts`.
- **All external API calls log cost** via `services/{vendor}/cost-counter`. Cron logs total to `CronRun.costUsd`.
- **Cache tags:** `business-${slug}`, `list-${id}`, `kw-${id}`, etc. Granular. Always.
- **Auth interrupts:** `forbidden()` / `unauthorized()` from `next/navigation`.
- **No `runtime = 'nodejs'` exports.** Turbopack defaults to Node.
- **i18n keys** in `messages/*.json`. No inline strings in `.tsx`.
- **Validate with Zod** at every boundary.

---

## Quality gates

Before every commit:

```bash
pnpm deploy-check
```

Which runs: format → typecheck → lint → build → cost-budget audit.

Required for: every PR, every autonomous loop iteration.

Performance budgets (per-route, enforced by `performance-auditor`):

- Lighthouse Mobile Performance ≥ 90
- LCP ≤ 2.0s · CLS ≤ 0.05 · INP ≤ 150ms
- First Load JS ≤ 200kB

---

## Data collection rules

See [docs/data-cadence.md](docs/data-cadence.md). TL;DR:

- **Daily** — cheap deltas (ads, brand hijack, new reviews)
- **Weekly** — anchor pull (profile, reviews, Lighthouse, SERP, score recompute)
- **Monthly** — slow data (keyword volume, market census, baselines)
- **On-demand** — user-triggered (re-audit, one-pager generation)

Every API call logs to `CronRun.costUsd`. Tier ceilings enforced — never silently overspend. **Any single call estimated > $5 needs Viktor approval** (see `docs/permissions.md`).

---

## Agents Index

| Agent                    | Role                                                                  | Tools                                                                   |
| ------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `code-reviewer`          | Quality review against checklist                                      | Read, Grep, Glob, Bash                                                  |
| `test-writer`            | Generate Vitest skeletons                                             | Read, Grep, Glob, Write, Edit                                           |
| `db-analyst`             | DB metrics + business queries                                         | `mcp__postgres__query`                                                  |
| `signal-engineer`        | Adding / tuning signals                                               | Read, Grep, `mcp__context7__*`                                          |
| `integration-specialist` | External APIs (DataForSEO, Meta, Stripe)                              | Read, Grep, WebFetch, `mcp__context7__*`                                |
| `performance-auditor`    | Lighthouse + bundle on changed routes                                 | Read, Grep, Glob, Bash                                                  |
| `process-enhancer`       | Daily meta-loop · refines rules/agents from build-log + scorer trends | Read, Grep, Edit, Write, Bash, `mcp__postgres__query`, `mcp__sentry__*` |
| `ux-reviewer-smb`        | SMB-portal UX                                                         | Read, Grep, Glob                                                        |
| `ux-reviewer-agency`     | Agency-portal UX                                                      | Read, Grep, Glob                                                        |
| `copy-reviewer`          | Voice + tone per audience                                             | Read, Grep, Glob                                                        |
| `scorer`                 | 5-dim score per phase, appends to PLAN.md                             | Read, Grep, Glob, Bash                                                  |
| `seo-auditor`            | GSC + on-page SEO health                                              | `mcp__gsc__*`, `mcp__postgres__query`                                   |
| `competitive-researcher` | External market research                                              | WebFetch, WebSearch                                                     |
| `analytics-analyst`      | GA4 funnels, attribution                                              | `mcp__ga__*`, `mcp__postgres__query`                                    |
| `sentry-monitor`         | Daily error triage                                                    | `mcp__sentry__*`                                                        |
| `security-auditor`       | Auth, CSRF, RBAC, rate limits                                         | Read, Grep, Bash                                                        |
| `payments-auditor`       | Stripe webhook + idempotency                                          | Read, Grep, Bash                                                        |
| `a11y-reviewer`          | WCAG 2.1 AA                                                           | Read, Grep, Bash                                                        |

---

## Skills Index

| Skill                       | Command                    | Purpose                              |
| --------------------------- | -------------------------- | ------------------------------------ |
| `mapsly`                    | `/mapsly`                  | Menu — list all skills               |
| `new-feature`               | `/new-feature [name]`      | Orchestrated feature build           |
| `change-feature`            | `/change-feature [module]` | Orchestrated modification            |
| `new-signal`                | `/new-signal [name]`       | Add a new signal                     |
| `deploy-check`              | `/deploy-check`            | format + types + lint + build + cost |
| `db-snapshot`               | `/db-snapshot`             | Metrics baseline to memory/          |
| **`autonomous-build-loop`** | `/autonomous-build-loop`   | The scheduled self-driving loop      |
| `cost-audit`                | `/cost-audit`              | Last-7d API cost vs budget           |
| `review`                    | `/review`                  | Spawn code-reviewer                  |
| `seo-check`                 | `/seo-check`               | Spawn seo-auditor                    |

---

## MCP servers

Registered in `.mcp.json`. Per-server rules in `.claude/rules/mcp-*.md`.

| MCP        | Use for                                         |
| ---------- | ----------------------------------------------- |
| postgres   | Live DB queries (SELECT only)                   |
| gsc        | Search Console — clicks, impressions, position  |
| ga         | GA4 traffic, behavior, conversions              |
| dataforseo | Keyword volume, SERP, Maps, Reviews, Lighthouse |
| context7   | Live framework / library docs                   |
| sentry     | Live errors, events, releases                   |

---

## Memory · institutional learning

- **`.claude/memory/incidents.md`** — every past failure with root cause + fix + prevention. **Read FIRST on every session.** Skipping this is a defect against `.claude/rules/incident-prevention.md`. Append a new INC- entry whenever a session encounters a failure with a non-obvious lesson.
- `.claude/memory/MEMORY.md` — Viktor's preferences and feedback. Read at session start. Never write autonomously without strong reason.
- `.claude/memory/build-log.md` — append-only diary of every autonomous session. Both the loop and Viktor read it.
- `.claude/memory/sessions/{date}-{n}.json` — per-session structured data the dev dashboard renders.
- `.claude/memory/enhance-signals.json` — process-enhancer's detected patterns + self-improvement signals.
- `.claude/memory/db-snapshots/` — captured metric baselines (from `/db-snapshot` skill).

**The contract:** every failure surfaces a lesson. Every lesson lives in `incidents.md` with a fix recipe and a prevention. Every future session reads `incidents.md` first. We never encounter the same issue twice.

---

## Blockers contract · the never-bother-Viktor-with-trivia rule

A "blocker" surfaces on dev.mapsly.ai ONLY when there is no programmatic path I have access to. This means:

- ✅ Block-list it if: requires ID verification (Meta Business, Stripe identity), requires logging into a third-party UI that has no API, requires a credential I genuinely don't have.
- ❌ DO NOT block-list: anything I can do via API token, CLI, or MCP. Set env var, push commit, run a script, configure a service via its REST API — those are mine to do, logged to `build-log.md`, not surfaced as a Viktor action.

When in doubt, attempt programmatically first. Only after a real failure (auth denied, no API exists) does it become a blocker.

The dashboard's "Blockers" card is the single source of truth for what Viktor must do. If something needs Viktor and isn't there, that's a defect — fix by either doing it myself or adding it to the queries/blockers.ts source.

## Real User Monitoring · piggybacks on Sentry browser SDK

We don't pay for Vercel Speed Insights or a 3rd-party RUM service. Sentry's
`@sentry/nextjs` browser SDK captures Core Web Vitals + Long Animation Frames
+ user-perceived latency automatically — into the same Sentry org we already
have set up. No new account, no new env var, just the existing `SENTRY_DSN`.

Wire in `instrumentation.ts` once Phase 8 (observability) lands:
- `Sentry.browserTracingIntegration()` captures CWV + page-load timings
- `tracesSampleRate: 0.1` (10% sample to stay within free quota)
- `replaysSessionSampleRate: 0.0`, `replaysOnErrorSampleRate: 1.0` (only record sessions when error fires)

The loop's `sentry-monitor` agent reads these via MCP and surfaces as
auto-enhance signals + per-route CWV trends on the dashboard.

## Hard reminders

1. **Performance is the #1 product requirement.** Slow page = broken page.
2. **SMB and Agency have different UX languages.** Don't mix them.
3. **Mapsly stops at "qualified lead."** No outreach automation in v1.
4. **Cost discipline is non-negotiable.** Every external call cost-tracked. > $5 needs approval.
5. **Autonomous dev runs on Pro Max x5 only.** Never the API.
6. **Tests cover invariants, not coverage %.** See `.claude/rules/testing.md`.
7. **i18n from day 1.** Strings in `messages/*.json`. No hardcoded English.
8. **Accessibility is part of "done."** ≥ 95 Lighthouse a11y on every route.
9. **Every change scored.** 5-dim scorecard appended to PLAN.md. 9.0 aggregate · 8.0 floor = ship.
10. **Boxly is reference, not source.** Read it for patterns; don't copy proprietary logic.

---

_Version 0.2 · 2026-05-19 · Phase 0 complete + quality-gate rule set landed. See PLAN.md for what ships next._
