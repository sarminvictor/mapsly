# Mapsly · product context

Compressed product facts for product-agnostic agents/skills. The full rules stay canonical:
`.claude/rules/ui-ux-smb.md` · `.claude/rules/ui-ux-agency.md` · `.claude/rules/copy-voice.md` · `CLAUDE.md`.

## What Mapsly is

Signal-driven local-business-intelligence platform. Two audiences, two portals, two UX
languages — never mixed. The 60+ signal vocabulary (reputation, search, ads, website,
profile, competitive, qualifiers) is the moat. Product stops at "qualified lead" — no
outreach automation in v1.

## Personas

### Maria · SMB owner · `/(smb)/` routes · $29/mo

- Owns one local business (e.g. a med-spa). Not a marketer.
- Logs in 5 min/day between appointments. Mobile-first — design at 380px.
- Her vocabulary: patients · treatments · providers (match her industry; guests/menu for
  restaurants, customers/jobs for auto-body).
- Wants: what's wrong, what do I fix, in what order. One CTA per screen. Big numbers,
  generous whitespace, max 4 KPIs above the fold. No dense tables on home.

### Tom · agency owner · `/(agency)/` routes · $49–$499/mo

- 4-seat local-marketing agency, ~25 clients, desktop-first (24"+ monitor), 8h/day.
- Wants qualified prospects for his pitch — speed, density, trust in the data.
- Fluent in jargon: MSI, local 3-pack, LCP, schema, NAP, GBP, SERP. Jargon is currency.
- Wants: dense tables (sticky headers, bulk actions), keyboard shortcuts (`⌘K`, `c`, `m`),
  optimistic updates, numbers over adjectives ("47 matches · 42 verified").

## Palettes

| Audience | Background          | Accent            | Type                            |
| -------- | ------------------- | ----------------- | ------------------------------- |
| SMB      | `#faf6f1` warm cream | `#c3553a` coral   | Fraunces headlines · Inter body |
| Agency   | `#f6f7fb` cool gray  | `#5b3df5` indigo  | Inter · JetBrains Mono for data |

Route group decides the palette. Never mix.

## Voice rules

Shared: active voice · sentence case in UI · em-dashes for breaks · no semicolons in UI
copy · no emoji in alerts/errors/body · no "please" · one apology max per error ·
imperative CTAs ("Save as list", not "Click here to…").

**SMB (Maria):** warm, plain English, like a smart neighbor. Outcome-first ("Patients see
your hours", not "Profile completeness improved"). Short sentences (~12 words). Prose,
not bullets. Exclamation marks only for wins. Every metric gets a one-line plain-English
tooltip with a benchmark. Errors: plain language + a next step.

**Agency (Tom):** tool-y and precise, like Linear/Vercel/Stripe. Terse labels ("Reply
rate < 25%"). Errors include a technical hint ("DataForSEO 503 · upstream issue · retry
in 2 min"). No hand-holding, no "Great job!".

### Banned words in SMB copy

ICP · MSI · CTR · schema · LCP · INP · CLS · 3-pack · organic rank · NAP · GBP · NPS ·
MoM · AOV · CAC · LTV. If one must appear (tooltip), explain it inline. All of these are
fine — expected — in Agency copy.

## Litmus tests

- SMB screen: "would Maria say 'yes, that's helpful'?"
- Agency screen: "would Tom say 'this is faster'?"
- Copy: read aloud — stumble = rewrite.
