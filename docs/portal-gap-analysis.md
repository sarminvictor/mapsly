# Mapsly Agency Portal — Prototype Gap Analysis & Build Plan

## 1. Verdict

The shipped agency portal is **far from the prototype — call it ~25% aligned**. The backend wiring is largely solid (discovery, enrichment, wallet, leads, touchpoints all have real data behind them), but the **front end was built as a thin, ad-hoc tool while the prototype is a designed product**. Three root causes compound: (1) **there is no shared agency design system** — no Space Grotesk display font, no yellow brand-punch, no token scale, no reusable component classes, so every screen hand-rolls inline Tailwind against the *SMB* warm palette; (2) **two signature screens are entirely missing** (Welcome hero, My Research directory, Enriching progress); and (3) **the core 5-step "Get leads" journey was never implemented as a flow** — Goal/Market/Preview/Discover/Enrich exist as disconnected utilitarian pages with a different mental model (cartesian auto-expand vs. curated markets; describe-your-offer vs. pick-a-signal-bundle). The leads **Workbench — the heart of the product — is the single biggest gap** (64h), shipped today as a 7-column read table with no match score, signals, vs-cell, filters, sort, bulk, or Fields menu, while a complete set of correct table primitives sits in the repo as dead code.

## 2. The design-system foundation (build this first — everything depends on it)

Nothing else is worth doing until this lands, because every screen currently hardcodes hexes against the wrong (SMB) palette. The prototype ships a complete, self-contained system in `docs/portal-prototype.html` (lines 13–6608) that is the contract.

**What must exist (one scoped CSS layer + font loading):**
- **Tokens** — port the prototype `:root` verbatim into a `.agency-scope` block (new `app/[locale]/(agency)/agency-portal.css`): `--bg #f4f5fb` (not the shipped `#f6f7fb`), full `--surface/-2`, `--ink/-2`, `--muted`, `--faint`, `--line/-2`; `--indigo` + `-50/-100/-700`; **`--yellow #f2e94e` + variants (the brand punch — completely absent today)**; `--mint` (shipped wrongly uses teal `#0891b2`); `--coral` + `-50/-100`; status greens/ambers/reds; `--radius 18px`, `--shadow/-sm/-lg`, `--mesh`.
- **Fonts** — load **Space Grotesk (`--display`)**, Inter (`--font`), JetBrains Mono (`--mono`) via `next/font/google` in the agency layout. The proven delivery pattern already exists in `(marketing-v2)`. Today the portal renders every heading/stat in Inter.
- **~40 reusable component classes** — `.card/.editorial`, `.btn[.primary/.punch/.ghost]`, `.pill/.statpill` (999px pills, not the shipped 5–6px mono-uppercase chip with a stray ⌄), `.seg/.seg2`, `.modal`, `.drawer`, `.filt/.fchip`, `.tpl`, `.stat`, `.callout`, `.sig+.track`, `.gauge`, table styles, workbench `.wb-toolbar/.wbpager`. Because they reference the ported tokens, the prototype CSS pastes in with zero renaming.
- **Focus ring** — agency focus is **indigo**, not the global SMB coral. Scope `.agency-scope :focus-visible { outline-color: var(--indigo) }`.

**Key decision baked in here:** keep the SMB tokens as-is and **scope all agency tokens under `.agency-scope`** so the two portals never collide. Effort: **~22h** (design-system area) — but this unblocks every screen below and removes per-screen reskin cost.

## 3. Screen-by-screen scorecard (ordered by build priority)

| # | Screen | Status | Top gaps | Effort |
|---|--------|--------|----------|--------|
| 0 | **Design system** | DIVERGENT (foundation) | No display font, no yellow, no token scale, no shared classes | 22h |
| 1 | **Global chrome** (rail, topbar, ⌘K, wallet, crumbs, toast) | DIVERGENT | Light rail vs dark mesh rail; no breadcrumb; no glass topbar; ⌘K is search-only not jump/router; no global toast; **nav taxonomy mismatch** | 22h |
| 2 | **My Research** (directory/home) | **MISSING** | Primary home object doesn't exist; no list query; no pinned/recent; no pin/archive/rename — *but schema already supports it* | 16h |
| 3 | **Welcome** (hero) | **MISSING** | Entire branded entry screen absent; no count-ups, peek mock, testimonials, single framing CTA | 11h |
| 4 | **Goal** ("What do you sell?") | DIVERGENT | Paradigm mismatch: free-text describe vs. pick-a-signal-bundle; no editable signal panel, no SIG_META recipes, no signal library | 40h |
| 5 | **Market** ("Where to look?") | DIVERGENT | No two-mode selector; cartesian auto-expand vs. curated markets; no typeahead, no goal rail, no 9-cap guardrails | 26h |
| 6 | **Preview** ("Before you spend") | DIVERGENT | No KPI cards, no per-cell credit matrix, no freshness callout; prices in **dollars not credits**; footer scopes wrong spend | 22h |
| 7 | **Discover** (raw list) | DIVERGENT | No 4 KPI stat cards, no sticky dark "Enrich the market" costbar, no hero/stepper — *table is actually richer than prototype* | 16h |
| 8 | **Enriching** (progress) | **MISSING** | No reassuring "close this page, we'll email you" progress screen; jobs feed isn't stage-aware | 12h |
| 9 | **Workbench — Leads** (the heart) | DIVERGENT | No tabs, Match %, signal columns, pain chips, vs-cell, Fields menu, filters, sort, group-by, density, pagination, bulk — *correct primitives exist but are dead code* | 64h |
| 10 | **Workbench — Touchpoints** | DIVERGENT | Standalone route not a tab; no stat strip, grouped/expandable cards, in-place edit, per-step regenerate/sent, multi-step sequences | 40h |
| 11 | **Billing & credits** | DIVERGENT | Split across 2 pages; **3 incompatible pricing models**; contradictory credit definition; no plans grid, top-up packs, credit explainer | 34h |

**Total raw effort: ~325h.** Statuses use PRESENT only where a screen matches; none qualified. "DIVERGENT" here means present-but-wrong-enough-to-rebuild, not cosmetic.

## 4. What we missed vs. the plan (Part 4.19/4.20 portal UX)

The plan specced the portal UX but the build diverged on the structural items:

- **Shared agency design system** (tokens/fonts/component classes) — specced as the foundation, **never built**; portal reuses SMB tokens + inline styles.
- **The 5-step "Get leads" journey** (Goal → Market → Preview → Discover → Enrich) with a stepper — **built as 4 disconnected pages, no stepper, no flow state**. There is no Goal step in agency routes at all.
- **Welcome / My-Research home objects** — the plan's designated front doors — **both missing**; the portal lands on the new-discovery picker (`/discover`).
- **Leads Workbench as a tabbed, dense, keyboard/bulk-first surface** (per `ui-ux-agency.md`) — **fragmented across 3 unrelated routes** (`/lists/[id]`, `/signals`, `/touchpoints`) with no shared shell, no Match %, no signals-on-the-table, no bulk on leads.
- **Credit-economy billing page** — specced as one unified narrative; **split into `/team/billing` (subscription) + `/usage` (wallet)`, with 3 conflicting pricing definitions.
- **Enriching progress / background-job reassurance** — specced (§4.20 comprehension layer); **only a topbar JobsTray glance widget exists**, no per-stage checklist, no email-on-done surface.
- **Dead-code primitives**: `modules/agency-portal/components/{LeadsTable,LeadRow,StatusPill,BulkActionBar,FilterRow}.tsx` were built (with density, sort, tokens) but **never imported** — the plan's components shipped, the screens just didn't use them.

## 5. Phased build plan

Each phase is one coherent, shippable slice. Dependency order is strict: **Phase 0 gates everything; the journey (1–4) feeds the workbench (5).**

### Phase 0 — Design-system foundation *(must ship first)*
**Ships:** scoped agency token layer + Space Grotesk/Inter/JetBrains Mono loading + ~40 ported component classes + indigo focus ring. Refactor the *existing* shared components (StatusPill → `.statpill`, etc.) onto the classes as the proof.
**Files:** `app/[locale]/(agency)/agency-portal.css` (new), `app/[locale]/(agency)/layout.tsx`, `app/globals.css`, `modules/agency-portal/components/StatusPill.tsx`.
**Effort:** ~22h. **Depends on:** nothing. **Blocks:** all phases.

### Phase 1 — Global chrome + IA
**Ships:** dark collapsible icon rail, frosted sticky glass topbar, route-driven breadcrumb, jump/command ⌘K, gold-coin wallet with amber-low state, avatar, **global toast provider**, mobile bottom-nav. **Includes the blocking nav-taxonomy decision** (see §6).
**Files:** `app/[locale]/(agency)/layout.tsx`, `components/agency/{AgencySidebar,CommandK,WalletPill,JobsTray,Breadcrumb,Avatar,Toast,AgencyTopbar}.tsx`, `messages/*.json`.
**Effort:** ~22h. **Depends on:** Phase 0. **Blocks:** every screen (toast + crumbs are shared).

### Phase 2 — Home & entry screens (high ROI, low risk)
**Ships:** **My Research directory** (`/research` — list query, pinned/recent, pin/archive/rename, set as default landing) + **Welcome hero** (`/welcome` — count-ups, peek mock, testimonials, one CTA). Schema already supports research; this is pure UI + a query + a few actions.
**Files:** `app/[locale]/(agency)/research/page.tsx`, `modules/agency-portal/research/*`, `app/[locale]/(agency)/welcome/page.tsx`, `modules/agency-portal/welcome/*`, sidebar + `messages/en.json`.
**Effort:** ~27h (16 + 11). **Depends on:** Phase 0–1. **Blocks:** nothing downstream — ship early for visible wins.

### Phase 3 — The "Get leads" journey
**Ships:** the stepped flow with shared GOAL state — **Goal** (pick-a-signal-bundle + editable signal panel + signal library), **Market** (two-mode curated-market selector + goal rail), **Preview** (KPI cards + per-cell credit matrix + credit-denominated dark costbar), **Discover** (4 KPI cards + sticky "Enrich the market" costbar + hero/stepper), **Enriching** (stage-aware progress screen + email-on-done).
**Files:** `modules/campaign/*` (GoalPicker, GoalDetail, SignalCard, SignalLibraryModal, goal-state), `modules/signals/{registry,library}.ts`, `modules/agency-portal/discover/components/*` (DiscoverFlow rewrite, MarketModeTabs, AddMarketBuilder, Preview*, EnrichCostBar, DiscoverKpiCards, EnrichingProgress), `modules/discovery/actions.ts`, `app/api/agency/jobs/route.ts`.
**Effort:** ~117h (Goal 40 + Market 26 + Preview 22 + Discover 16 + Enriching 12 — minus overlap, the discover trio shares the costbar/KPI work). **Depends on:** Phase 0–1; Goal must land before Market/Preview can read GOAL. **This is the biggest, riskiest phase** — see §6 for the paradigm decision.

### Phase 4 — The Workbench (the heart)
**Ships:** tabbed Leads + Touchpoints workbench over one shared state — Match %, goal-signal columns, pain chips, vs-cell toggle, Fields menu, filters, sort, group-by, density, numbered pagination, bulk bar; touchpoints as a grouped/expandable, in-place-editable, multi-step grounded sequence tab. **Adopt the dead-code primitives, delete the inline tables.**
**Files:** `app/[locale]/(agency)/discover/[discoveryId]/lists/[listId]/page.tsx`, `modules/agency-portal/discover/components/{LeadsWorkbench,FieldsMenu,LeadsFilters,CoverageLine,TouchStats,TouchStepCard,TouchpointsBulkBar,TouchpointsList}.tsx`, `modules/agency-portal/components/{LeadsTable,StatusPill,BulkActionBar,FilterRow}.tsx` (adopt), `leads-columns.ts`, `leads-filter.ts`, `modules/outreach/*`, query + schema extensions (`Lead.matchScore`, touch state).
**Effort:** ~104h (Leads 64 + Touchpoints 40). **Depends on:** Phase 0–1, and Phase 3's GOAL signal set (signal columns + pain chips need findings/match data). **Largest single effort — schedule deliberately, likely 3–4 sessions.**

### Phase 5 — Billing & polish
**Ships:** unified Billing & credits page (credit explainer, current-plan/wallet bar, plans grid, what-a-credit-buys, top-up packs + checkout, compare block, running-balance ledger). **Gated on the pricing reconciliation decision.**
**Files:** `app/[locale]/(agency)/team/billing/page.tsx` (merge `/usage` in), `components/agency/billing/*`, `modules/cost/pricing.ts`, `modules/billing/{plans,checkout,webhook}.ts`, `messages/*.json`.
**Effort:** ~34h. **Depends on:** Phase 0–1; **blocked on Viktor's pricing decision** (tagged `human-required` — payments + schema).

## 6. Recommendation

**Sequence: 0 → 1 → 2 → 3 → 4 → 5, exactly as phased.** Foundation is non-negotiably first (it cuts rework on all 11 screens). Then chrome (shared toast/crumbs everything else needs). Then ship **Phase 2 (Research + Welcome) early** — it's cheap, low-risk, high-visibility, and gives you a real front door while the hard work proceeds. Phases 3 and 4 are the bulk (~220h of ~325h) and where the product actually lives; do not start the Workbench (4) before the Goal step (3) exists, since the signal columns depend on the GOAL signal set.

**Rebuild vs. reskin:** **Reskin the chrome and tables, rebuild the journey and workbench.** The backend (discovery/enrich/wallet/leads actions, cost gates, registry) is good — **keep all data wiring**. The divergence is overwhelmingly presentational + flow-structural, except Goal (genuine paradigm change) and Billing (genuine model conflict).

**Decisions Viktor must make before the dependent phases start:**
1. **Nav taxonomy (blocks Phase 1):** prototype's *Get leads / My research / Billing / Settings* vs. shipped *Discover / Campaigns / Touchpoints / Settings*. Lock the route↔label↔crumb map first — everything else is renames after.
2. **Goal paradigm (blocks Phase 3, the 40h item):** adopt the prototype's **pick-a-signal-bundle** model (recommended — it's the moat made visible) and demote the existing free-text intake to a "Custom" path? Or keep free-text? This is the single highest-leverage call.
3. **Market model (Phase 3):** curated `{city × category}` pairs with a 9-cap (recommended — predictable spend) vs. the current cartesian auto-expand.
4. **Credits everywhere (Phase 3 + 5):** the portal must speak **credits, not dollars** — confirm so Preview/costbars are built right the first time.
5. **Pricing reconciliation (blocks Phase 5, `human-required`):** three live models disagree (pricing.ts SOLO/GROWTH/PRO/BOUTIQUE 600–12,000 cr; plans.ts $49–$499; prototype Free/Starter/Growth/Scale $0–$299 / 150–24,000 cr) **and** the credit definition contradicts itself ("1 credit = 1 lead-with-contacts" vs. "1 credit = 1 fully-enriched lead"). Pick one canonical registry before any billing UI.

If you want a fast confidence-builder before committing to the big phases: **Phase 0 + Phase 2** together (~49h) gives a correctly-branded portal with a real home and entry hero — visible proof the system works — without touching the risky journey/workbench rebuilds.