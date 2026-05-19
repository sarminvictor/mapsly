---
description: SMB audience patterns. Maria's portal. No jargon, simple visuals, friendly tone. Loaded for any agent touching /(smb)/ routes.
globs:
  ["app/(smb)/**/*.tsx", "modules/smb-*/**/*.tsx", "modules/reviews/**/*.tsx"]
alwaysApply: true
---

# UI/UX · SMB audience (Maria)

## Who is Maria

- Owner of one local business (e.g. Solea Brickell Spa, a med-spa)
- Vocabulary: "patients", "treatments", "consultations", "providers", "front desk"
- **Not** a marketer. Doesn't know what schema markup is, doesn't know what "local 3-pack" means, doesn't read CTR curves.
- Logs in once a day for 5 minutes. Wants to know: **what's wrong, what do I fix, in what order**.
- Mobile-first user — checks the app between client appointments.

## Audience principles (apply to every SMB page)

### Tone of copy

- **Direct, warm, plain English.** Speak the way her front-desk manager would.
- **Outcome over metric.** "Patients will see your hours" beats "Schema attribute completeness improved".
- **Use her vocabulary.** Med spa: patients/treatments/providers. Restaurant: guests/menu items/servers. Auto body: customers/jobs/techs.
- **Never use:** ICP, MSI, CTR, schema, LCP, INP, CLS, 3-pack, organic rank, NAP, GBP, MoM, AOV, CAC, LTV.
- **Always explain jargon inline** if it must appear: "your reply rate (% of reviews you've responded to)".
- **Show the math.** Every dollar figure has the inputs visible on hover/click.

### Visual language

- **Cream-warm palette.** `--color-bg: #faf6f1`. Coral accent `--color-coral: #c3553a`. Fraunces serif headlines, Inter body, JetBrains Mono only for technical sub-text.
- **Big numbers, generous whitespace.** A single score (6.2/10) in 48px serif beats a dense table.
- **One CTA per screen.** Don't make her choose. The dashboard's CTA is "Reply to reviews", because that's the highest-impact fix.
- **Status colors are semantic + redundant.** Red dot + label "Needs attention". Green check + "Healthy". Never color alone.

### Information density

- **Below the fold** for anything beyond 4 KPIs.
- **No dense tables on the home page.** Tables go inside drilled-in detail views.
- **Charts are bar/line only.** No radar charts, no scatter plots, no Sankey, no treemap.
- **Sparklines** are OK as supporting visualization next to a KPI tile.
- **Tooltips on every metric** explaining what it measures in 1 plain-English sentence + benchmark.

### Interactions

- **Tap-targets ≥ 44×44px** (mobile-first)
- **Form fields auto-save** where it makes sense (settings, notes)
- **Confirm destructive actions** (delete account, cancel subscription)
- **Optimistic updates** (mark review replied, post AI draft) with subtle status feedback, not full spinners

### Empty states

Every empty state explains **why empty + what to do**:

- ✅ "No new reviews this week. We'll surface them here as they arrive."
- ❌ "No items"

### Error states

- Plain language. "We couldn't connect to Google right now. Try again in a minute." NOT "ECONNREFUSED at line 42".
- Always offer a next step ("Try again" / "Email support").

### Mobile priority

- 380px viewport is the target — design there first.
- Sidebar collapses into a bottom nav on mobile.
- KPI tiles stack 2-column on mobile, 6-column on desktop.

## Page templates · SMB

### Dashboard (home)

- Top: single hero KPI (Mapsly Score 6.2/10) + 5 supporting KPIs
- Middle: "What needs your attention today" (max 4 cards, ordered by impact)
- Lower: 3 highest-impact fixes (with one-line plain-English action + impact preview)
- Bottom: this week's activity (cards, not table)

### Reviews

- Tabs at top: Unanswered (default) / Negative / All / By theme
- Each review card: reviewer + stars + date + text + AI reply draft
- AI reply panel is collapsible, EN+ES toggle, "Post to Google" primary CTA
- Right rail: rating distribution, theme analysis, reply-tone settings

### Other pages

- See `_design/product/*.html` for the reference mocks
- Stick close to the reference — those were validated with Maria

## Copy register · examples

| Context          | ❌ Wrong                              | ✅ Right                                                          |
| ---------------- | ------------------------------------- | ----------------------------------------------------------------- |
| Dashboard header | "Optimize your local SEO performance" | "What's happening with your spa this week"                        |
| Score tooltip    | "MSI rank — Market Share Index"       | "Where you stand among 40 spas in Miami"                          |
| Reply rate       | "Your owner_response_rate is 0%"      | "You haven't replied to any reviews. Most spas reply to 89%."     |
| Action CTA       | "Initiate review reply workflow"      | "Reply to 8 unanswered reviews"                                   |
| Error            | "Failed to fetch resource"            | "We couldn't load this. Try again in a minute."                   |
| Empty            | "No data"                             | "No new reviews this week. We'll show them here as they come in." |

## What Maria pays for

She pays $29/mo to feel in control. The UX must make her feel:

1. **I understand what's going on with my business.** No mystery numbers.
2. **I know what to do next.** Top 3 fixes prioritized.
3. **I can do it without help.** Each fix has an inline how-to or an "Apply with one click".
4. **Someone's got my back.** Daily check-in feels like having an assistant.

Every UI decision passes the "would Maria say 'yes, that's helpful'?" test.

## Anti-patterns

- ❌ Acronyms without explanation
- ❌ Tables with > 6 columns on the home page
- ❌ Multi-axis charts
- ❌ "Click here to learn more" — link the actual phrase
- ❌ Modal cascades (modal opens modal)
- ❌ Settings pages mixed with action pages
- ❌ Showing the formula behind a score without simplifying it
- ❌ Asking Maria to make a technical decision (signal weights, refresh cadence, schema config)
