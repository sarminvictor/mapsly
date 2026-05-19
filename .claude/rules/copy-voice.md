---
description: Voice & tone per audience. Master reference for any agent writing copy.
globs: ["**/*.tsx", "**/*.md"]
alwaysApply: true
---

# Copy voice

Mapsly has two audiences with two distinct voices. Every copy decision starts here.

## SMB voice (Maria)

- **Warm, direct, plain English.** Like a smart neighbor giving advice.
- **Outcome-first.** "Patients see your hours" not "Profile completeness improved".
- **Industry vocabulary** matches their ICP (patients/treatments for med-spa; guests/menu for restaurant; customers/jobs for auto-body).
- **Banned words:** ICP, MSI, CTR, schema, LCP, INP, CLS, 3-pack, organic rank, NAP, GBP, NPS, MoM, AOV, CAC, LTV. If a banned word must appear (in a tooltip), explain it inline.
- **No bullet lists** in conversational copy. Prose only.
- **Short sentences.** Average 12 words. Read aloud — if you stumble, rewrite.
- **No exclamation marks** in alerts/errors. Save them for wins ("Reply posted!").

## Agency voice (Tom)

- **Tool-y, precise, jargon-OK.** Like Linear / Vercel / Stripe dashboard.
- **Numbers over adjectives.** "47 matches · 42 verified" not "lots of fresh prospects".
- **Imperative actions.** "Add to outreach", "Mark contacted", "Clone list".
- **Jargon is currency.** Local 3-pack, LCP, MSI, GBP, NAP all welcome — Tom knows them.
- **Glossary tooltips** still available for the rare term he forgets.
- **Short labels.** "Reply rate < 25%" not "Owner reply rate below 25 percent of last 20 reviews".

## Shared rules

- **Active voice.** "We index 2.1M businesses" not "2.1M businesses are indexed".
- **Sentence case in UI.** "Add to outreach" not "Add To Outreach" or "ADD TO OUTREACH".
- **Em-dashes for natural breaks** — like this — not commas-everywhere.
- **No semicolons in UI copy.** They're for prose, not buttons.
- **No emoji** in alerts, errors, body copy. Reserved for service-category badges (🌐 Website rebuild) and onboarding celebration.
- **No "please".** Don't beg the user — guide them.
- **No "we're sorry"** repeated. One apology per error message max.

## Voice-by-context examples

### Onboarding email subject line

| Audience | ❌ Wrong                         | ✅ Right                                    |
| -------- | -------------------------------- | ------------------------------------------- |
| SMB      | "Welcome to Mapsly!"             | "Maria — your weekly check-in is ready"     |
| Agency   | "Get started with Mapsly today!" | "Anchor Local · 6 lists ready · review now" |

### Empty list

| Audience | ✅ Right                                                          |
| -------- | ----------------------------------------------------------------- |
| SMB      | "No new reviews this week. We'll show them here as they come in." |
| Agency   | "No qualified leads. Adjust filters or wait for next refresh."    |

### Error · DataForSEO 5xx

| Audience | ✅ Right                                                                   |
| -------- | -------------------------------------------------------------------------- |
| SMB      | "We couldn't refresh your data right now. Try again in a few minutes."     |
| Agency   | "DataForSEO 503 · upstream issue · retry in 2 min · status.dataforseo.com" |

### CTA on a fix card

| Audience | ✅ Right                        |
| -------- | ------------------------------- |
| SMB      | "Reply to 8 unanswered reviews" |
| Agency   | "Bulk-draft replies (8)"        |

### Tooltip on "Reply rate"

| Audience | ✅ Right                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------- |
| SMB      | "The percentage of your reviews where you've replied. Most spas reply to about 89%."                 |
| Agency   | "% of last 20 reviews with owner_answer. Benchmark 89%. Filter trigger for review-management lists." |

## Microcopy patterns

### Buttons

- **Primary action:** Imperative verb + object. "Save as list", "Open lead", "Post to Google".
- **Secondary action:** Verb. "Edit", "Skip", "Cancel".
- **Destructive:** Specific. "Delete list" not "Delete". "Cancel subscription" not "Cancel".

### Confirmations

- "Are you sure you want to delete this list? You'll lose 47 qualified leads."
- Always state what's lost. No generic "Are you sure?"

### Toasts

- Success: ≤ 5 words. "Reply posted · A.C. (1★)"
- Error: ≤ 15 words. State what failed + what to do next.
- Auto-dismiss after 3s for success, 7s for error. Persistent for critical errors.

### Form labels

- Sentence case, no colon. "Reply tone".
- Help text below: one line, conversational.

### Pluralization

- Use `Intl.PluralRules` in code:
  ```ts
  const n = items.length;
  const word = new Intl.PluralRules("en").select(n);
  // → 'one' | 'other'
  ```
- Translations include zero/one/two/few/many/other where applicable.

## Internationalization implications

When copy moves to i18n strings (see `i18n.md`):

- Translation keys reflect audience: `smb.dashboard.empty_state` vs `agency.lists.empty_state`
- Translators get tone guide (this doc) + screenshot context
- Never machine-translate without a human pass — voice gets flattened
- Locale-specific phrasing: "patients" (English med-spa) vs "pacientes" (es med-spa) vs "patientes" (fr-CA)

## Anti-patterns

- ❌ Mixing voices within a page ("Hi friend, manage your OAuth tokens here")
- ❌ Hyperbole in SMB ("AMAZING reviews!")
- ❌ Hand-holding in Agency ("Don't worry, this is easy!")
- ❌ Jargon in SMB without inline explanation
- ❌ Hidden jargon in Agency (he wants the technical term)
- ❌ Title Case in UI (Sentence case)
- ❌ Sentence-ending exclamation marks in errors
- ❌ Generic "Something went wrong"
