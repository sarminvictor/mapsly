---
description: Agency audience patterns. Tom's portal. Power-user UI, dense info, jargon OK, keyboard-first. Loaded for any agent touching /(agency)/ routes.
globs:
  [
    "app/(agency)/**/*.tsx",
    "modules/hunter/**/*.tsx",
    "modules/lists/**/*.tsx",
    "modules/prospect/**/*.tsx",
    "modules/reports/**/*.tsx",
  ]
alwaysApply: true
---

# UI/UX · Agency audience (Tom)

## Who is Tom

- Owner of a small local-marketing agency (e.g. Anchor Local, Toronto)
- 4 seats. Manages ~25 client accounts + prospects 8h/day.
- Fluent in marketing vocabulary: SERP, MSI, CTR, schema, GBP, NAP, local 3-pack, retainer, MRR, CAC, LTV.
- Comfortable with **dense tables, filters, keyboard shortcuts**.
- Desktop-first (24+ inch monitor). Mobile is a glance, not a workflow.
- Wants **speed** — every extra click is friction across 50 prospects/day.

## Audience principles (apply to every Agency page)

### Tone of copy

- **Tool-y, precise, no fluff.** Like a senior SaaS product — Notion, Linear, Vercel dashboard.
- **Jargon allowed and expected.** "Local 3-pack", "LCP", "schema markup", "MSI" — Tom knows what these mean.
- **Numbers over adjectives.** "47 matches · 42 verified" beats "lots of fresh prospects".
- **Imperative actions.** "Add to outreach". "Mark contacted". "Clone list". No "Please consider initiating..."

### Visual language

- **Cool gray light palette.** `--color-agency-bg: #f6f7fb`. Indigo accent `--color-agency-indigo: #5b3df5`. Inter throughout — no serif. JetBrains Mono for technical/data.
- **Information density.** Dashboards pack 6–8 KPIs across, tables show 8+ columns, side rails carry context. Tom can scan 100 rows in 10 seconds.
- **Tables are first-class.** Use them. Sticky headers, sortable columns, bulk-action bars.
- **Charts can be complex** if they serve a workflow: funnel charts (5-stage), correlation bars (rank-and-percent), spatial maps with category overlays.

### Information density

- **Above the fold** is for the workflow — list of prospects, list of clients, status bar with counts.
- **Side rail** for context — summaries, glossary, definitions, related actions.
- **Hover-reveals** for card actions (clone, pause, more menu).
- **Tooltips** for every signal name (still want plain-English explanations available — Tom forgets specific jargon too).

### Interactions

- **Keyboard shortcuts** for everything frequent:
  - `⌘K` global search ("Look up a business…")
  - `c` clone list
  - `m` mark contacted (selected lead)
  - `e` open in editor
  - `?` show all shortcuts
- **Bulk actions** mandatory on every list/table — multi-select with `Shift+click`.
- **Optimistic updates** for status changes (no spinner — change the pill instantly).
- **Inline editing** where it speeds work: filter values, list pitch, lead notes.

### Tables / lists

- **Sticky header** on scroll
- **Row hover** highlights
- **Click row** → opens detail (not just the action button)
- **Status pills** are clickable and cycle through states
- **Column resizing** (when columns are dense)
- **Density toggle** Comfortable / Compact (Compact = Tom's default after week 1)

### Modals + side panels

- **Modal** for create-list, save-as-list, confirm-destructive
- **Side panel** for "open lead in detail without losing list context" — slides in from right, doesn't navigate away
- **Escape closes** all overlays
- **Focus trap** while open

### Empty + error states

- More terse than SMB:
  - ✅ "No new matches today. Refresh due tomorrow 6am."
  - ✅ "Couldn't load. Check your DataForSEO credentials."
- Errors include a technical hint so Tom can self-diagnose: "503 from upstream · check status.dataforseo.com".

## Page templates · Agency

### Lists (home)

- Service-template strip at top (Website / Meta ads / Local SEO / etc.) — one-click filter starters
- Today's-new-matches summary row
- Lists grid · service badge per card · hover-reveal actions (clone, pause, more)
- Paused section below
- No greeting copy — get to the workflow immediately

### Hunter / Search

- Step 1: pick service template
- Step 2: target market (category, geo, radius)
- Step 3: tune filters (60+ rows, comparator + value editable)
- Sticky preview bar: live match count + filter summary + "Save as list" + "See results"
- Live updates as filters change

### List detail

- Hero: pitch + 5 KPIs (qualified / new this week / already contacted / refresh cadence / created)
- Filter chips bar (the actual filters defining the list, with edit affordance)
- Status tabs: New (default) / Contacted / Replied / Won / Lost / Hidden
- Table rows: business, why-qualified signals, status pill (clickable), contact, action
- Sticky bulk-action bar appears when rows selected

### Prospect detail

- Hero: avatar, name, address, meta, prev/next nav, Mark Contacted, Mark Client, Generate one-pager
- Top stats row (6 KPIs)
- "Why this lead qualifies" — 4 numbered pitch wedges with evidence footers (this is the closing weapon)
- Signal blocks below: Reviews / Competitors / Search / Ads / Website (collapsible, dense)
- Right rail: contact, appears-in-lists, notes (saved per-team), data sources

### List analytics

- 4-stat header (surfaced 90d / contact rate / reply rate / closed won)
- Per-list table with mini-funnel viz per row
- Signal correlation panel (which signals predict replies)
- Insight callout at bottom

## Copy register · examples

| Context         | ❌ Wrong                              | ✅ Right                                                          |
| --------------- | ------------------------------------- | ----------------------------------------------------------------- |
| Hunter header   | "Search local businesses easily!"     | "Search · 2.1M businesses · 60+ signals"                          |
| Empty list      | "Looks like there's nothing here yet" | "No qualified leads. Adjust filters or wait for next refresh."    |
| Filter help     | "How many reviews this business has"  | "Review count — proxy for revenue. ≥100 means active operations." |
| Lead row action | "Click here to manage this lead"      | "Open →"                                                          |
| Error           | "Something went wrong"                | "DataForSEO 503 · upstream issue · retry in 2 min"                |

## What Tom pays for

He pays $99/mo for ROI on his time. The UX must make him feel:

1. **I save time.** Fewer clicks than my last workflow.
2. **I see things competitors can't.** Signal vocabulary unique to Mapsly.
3. **I trust the data.** Sources visible, refresh times honest.
4. **I can scale.** Bulk actions, keyboard shortcuts, team scoping.

Every UI decision passes the "would Tom say 'this is faster'?" test.

## Anti-patterns

- ❌ Hand-holding copy ("Great job!", "Welcome back!", emoji explosions)
- ❌ Forcing modals when a side panel works
- ❌ Hiding bulk actions behind multiple clicks
- ❌ Loading spinners when optimistic UI works
- ❌ Wrapping tables in cards with so much padding they feel small
- ❌ "Friendly" empty states that say nothing
- ❌ Dumbing down jargon Tom needs (he wants the technical name, with explanation available via hover)
