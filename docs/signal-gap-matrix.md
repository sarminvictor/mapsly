# Signal alignment — gap matrix & build plan

Goal (Viktor, 2026-06-30): the **full prototype signal library (47)**, every one **genuinely computed on real businesses** (no mocks), with the **expandable + tunable cards**, fully wired into the product.

Source of truth: `docs/portal-prototype.html` `SIG_META` (lines ~9290–10091, 47 entries) + `sigSetting()` (~10103).

## ⚠️ The load-bearing finding — signals don't actually FILTER yet

The agency **discover flow does not evaluate signals against businesses.** The Hunter evaluator (`modules/hunter/evaluate.ts`) exists but (a) is **not wired into** `modules/agency-portal/discover/**`, and (b) its `MODEL_TO_SLOT` only resolves 6 models — `BusinessTech`, `PlaybookFinding`, `BusinessKeyword`, `Contact`, `AdMarketRun`, `BusinessLicense` all resolve to `undefined`.

Today the discover flow filters by **category + geo + reachability + one reviewCount-vs-cohort percentile**, and **match% = count of flagged PlaybookFindings**, not signal eval. So the goal-step signals are currently **decorative in the flow** — toggling them changes nothing about which businesses come back.

➡️ "Make signals work" therefore = **(1) compute each signal's value per business + (2) build a discover-flow signal-eval layer so toggles actually filter.** (2) is the biggest structural piece and is currently absent.

## Verdict counts (47)

| Verdict          | Count | Meaning                                                                                           |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------- |
| **READY**        | ~18   | Real per-business value already stored — just needs surfacing + eval wiring                       |
| **PARTIAL**      | ~22   | Inputs stored, but the signal isn't assembled/derived                                             |
| **NOT-COMPUTED** | ~3    | Inputs present, nothing derives it (trend/spike)                                                  |
| **MISSING**      | ~4    | No product equivalent (Multi-location, High-ticket category, Hiring now, privacy-policy detector) |

Goal-step surfaces only **20** of the 47 today (19 prototype + 1 goal-only "Phone-only"). **~13 of the 28 absent are already READY** — surfacing them is mostly presentation + a registry binding.

## Build clusters (batch the work)

- **Cluster A — eval wiring (highest ROI, S–M).** Build a discover-flow signal resolver (or extend `evaluate.ts` MODEL_TO_SLOT) to read `BusinessTech` / `PlaybookFinding` / `BusinessKeyword` + the 6 existing models. Unblocks ~8 READY-but-unfilterable signals (DIY platform, no pixel, chat, e-commerce, flying blind, legal&compliance, low organic, losing rankings).
- **Cluster B — review trend/spike (S–M).** From `BusinessSnapshot` (daily rating, velocity30, velocityPrev30, reviewLifecycle) + `Review`: Review momentum (4-state), Reviews trending up, Rating slipping (90d), Reputation fire (spike), Reputation slipping (composite).
- **Cluster C — cell percentiles (M).** Extend `CellMetric.distributions` with organic-traffic + organic-rank: Market position, Search visibility, Invisible locally, Low organic traffic (scale band).
- **Cluster D — ad creative/landing (S).** From `AdLibraryEntry`: Ads-point-at-homepage, Stale creative, the ads-without-pixel/analytics composites.
- **Cluster E — SERP brand/rank (M).** Extend `cell-intel/serp.ts`: Branded-only traffic, Losing rankings (90d trend).
- **Cluster F — review-theme NLP, generalized (M).** Generalize `playbooks/signals/medspa/review-complaint-cluster.ts` across verticals: Recurring complaint theme.
- **Cluster G — service-prevalence gap (M).** Assemble per-business "missing N common services" from `BusinessService` + cell prevalence.
- **Cluster H — new external data (L).** Hiring now (job scrape), Multi-location (chain clustering), High-ticket category (curated table), Stale social post-recency, Competitor pressure (new-entrant proximity), true site-age (WHOIS/Wayback), privacy-policy detector (DOM).

## Settings inventory (the card UX must render all 6)

| type       | control                             | #   | notes                             |
| ---------- | ----------------------------------- | --- | --------------------------------- |
| strictness | loose↔strict slider                 | 12  | + default fallback                |
| scale      | 5-band radio, multi-select          | 3   | bottom10/below/around/above/top10 |
| mode       | N-option select w/ descriptions     | 4   | e.g. Review momentum (4 states)   |
| platform   | multi-select chips (+allowNone/Any) | 6   | e.g. booking tools, CMS           |
| presence   | has/hasn't toggle                   | 6   |                                   |
| none       | no control                          | 1   |                                   |

`SigMeta` in `goal-templates.ts` carries only `comparator`+`value` today — porting needs a `setting` descriptor (discriminated union of the 6 types) added to the interface. A single generic `<SignalCard>` driven by `setting.type` covers all 47.

## Phased build (each a reviewable phase; nothing pushed until Viktor approves)

1. **A1 · Definitions** — port all 47 (+ recipe, conf, status, `setting`, registry binding) into `goal-templates.ts` SIG_META; keep the existing 20 working.
2. **C · Card UX** — generic expandable/tunable `<SignalCard>` rendering the 6 setting types + per-condition toggles + match-mode + Remove. (Add-signal picker already built.)
3. **A-eval · Discover-flow signal resolver** — make toggles actually filter (per-business value resolver + eval over the toggled signals/settings) in preview/discover/workbench. **The core "make them work" piece.**
4. **B–H · Computation** — build the derivations/new-data per cluster so PARTIAL/MISSING signals fire on real data, highest-ROI first (A→B→D→C→E→F→G→H).

Status: see tasks #20–#24.
