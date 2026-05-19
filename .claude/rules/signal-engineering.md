---
description: How to add or modify signals. The 60+ filterable signals are the product's moat.
globs:
  ["modules/signals/**/*.ts", "modules/hunter/**/*.ts", "modules/lists/**/*.ts"]
---

# Signal engineering

A **signal** is one filterable, displayable, scoreable fact about a business. The 60+ signals are Mapsly's moat. Adding one is a deliberate act with downstream impact on UI, DB, cost, and scoring.

## Anatomy of a signal

Every signal has 5 components:

1. **Source** — where the data comes from (DataForSEO Maps, Reviews API, Lighthouse, Meta Ad Library, internal compute).
2. **Storage** — which Prisma model holds it (`Business`, `BusinessSnapshot`, `Review`, `LighthouseAudit`, etc.).
3. **Refresh cadence** — daily / weekly / monthly. Matches the source's cost profile.
4. **Filter definition** — how the agency Hunter exposes it as a tunable filter (comparator + value).
5. **Display surface** — where it appears in SMB or Agency portals.

## Adding a new signal — checklist

Before you write code:

- [ ] Justify it: which agency pitch / SMB use-case does it unblock?
- [ ] Check it's not already collected (run `/db-snapshot` or grep `prisma/schema.prisma`)
- [ ] Cost estimate: what's the marginal cost per business per refresh cycle?
- [ ] Cadence: does daily / weekly / monthly fit?

When you write code:

- [ ] Add the column to the appropriate Prisma model (with index if filterable)
- [ ] Add to the relevant cron job (or create one)
- [ ] Wrap the data fetch in a `services/{vendor}` adapter (cost-tracked)
- [ ] Add to `modules/signals/registry.ts` — the canonical filter definition
- [ ] Add to the relevant Hunter filter group in `modules/hunter/groups.ts`
- [ ] Add to the Prospect detail view if it's per-business surfaceable
- [ ] Update `docs/data-cadence.md`
- [ ] Update the signals-coverage matrix (`_design/product/signals-coverage.html`)

## Signal registry shape

```ts
// modules/signals/registry.ts
export const signals = {
  reply_rate: {
    label: "Owner reply rate (last 20 reviews)",
    helpTooltip:
      "% of last 20 reviews with an owner response. Industry benchmark ~89%.",
    group: "reviews",
    type: "numeric",
    comparators: ["<", "≤", "=", "≥", "between"],
    valueUnit: "%",
    defaultValue: 25,
    source: "computed-from-reviews",
    cadence: "weekly",
    column: "BusinessSnapshot.communicationScore",
  },
  // ...
} as const;
```

Every signal is registered once. The Hunter UI, the Prospect view, and the cron job all read from this registry.

## Signal categories

Keep the 8 categories stable. New signals slot into existing categories:

1. **Website / Tech** (Lighthouse + DOM)
2. **Search / Local SEO** (SERP + GBP)
3. **Ads / paid** (Meta + Google)
4. **Reviews / reputation** (Reviews API + AI)
5. **Profile completeness** (Maps fields)
6. **Competitive / geo** (proximity, new entrants)
7. **Business qualifiers** (revenue proxies)
8. **Exclusions** (skip filters)

Adding a 9th category is a design decision — get explicit user buy-in first.

## Naming conventions

- Signal key: `snake_case`, descriptive (`unanswered_1star_aged`, not `u1a`)
- Filter label: human-readable, no jargon (`"Unanswered 1★ aged"`)
- Tooltip: plain English, no jargon, explain what it measures + benchmark

## What NOT to do

- Don't add a signal that's just a re-shape of an existing one (e.g. "Reply rate inverted"). Compose filters at the Hunter layer instead.
- Don't add a signal that requires live API in the user path. If the cadence doesn't fit, the signal can't exist.
- Don't add a signal without filter UI. Hidden signals are dead weight.
