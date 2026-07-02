# Outreach CSV export — Instantly / Smartlead column mapping (WP6-6)

> The touchpoints CSV (`Export drafts` in the Touchpoints bulk bar, wired in
> WP5-7) is shaped to drop straight into **Instantly** or **Smartlead** with the
> evidence already attached as custom variables. This doc is the preset column →
> sender-field mapping so a Mapsly export is the obvious upstream source for
> either sending rail.
>
> Source of truth for the columns: `modules/outreach/handoff.ts`
> (`exportDraftsCsv` → `CSV_HEADER`). Bump this doc whenever that header changes.

## What the export is (and isn't)

- Mapsly **does not send**. It produces a compliant, evidence-grounded CSV you
  load into your own sender. (Stops at the qualified-lead + draft handoff.)
- Every row is **CAN-SPAM sendable by construction**: a draft whose business has
  no physical mailing address is refused (never written), and every row carries
  a `mailingAddress` + `unsubscribeNote` column. See `docs/cold-email-audit-*`.

## The columns

| Column            | Meaning                                                | Instantly field                  | Smartlead field            |
| ----------------- | ------------------------------------------------------ | -------------------------------- | -------------------------- |
| `draftId`         | Mapsly draft id (dedupe / re-import key)               | custom var `{{draftId}}`         | custom var `{{draftId}}`   |
| `businessId`      | Mapsly business id                                     | custom var                       | custom var                 |
| `businessName`    | Business name                                          | custom var                       | custom var                 |
| `company_name`    | Business name (sender-default field name)              | **Company Name**                 | **Company**                |
| `email`           | Verified business email                                | **Email** (required)             | **Email** (required)       |
| `phone`           | Business phone                                         | **Phone**                        | **Phone Number**           |
| `website`         | Business website                                       | **Website**                      | **Website**                |
| `channel`         | `email` / `dm` / `phone` / `social`                    | custom var `{{channel}}`         | custom var `{{channel}}`   |
| `sequenceStep`    | 1-based step within the 1–3 touch sequence             | custom var `{{sequenceStep}}`    | custom var                 |
| `sequenceOf`      | Total steps in the sequence                            | custom var `{{sequenceOf}}`      | custom var                 |
| `subject`         | First-touch subject (email only)                       | **Subject** (or template)        | **Subject**                |
| `body`            | The generated draft body                               | **Body** (or template)           | **Body**                   |
| `personalization` | The single sharpest grounded reason (why[0])           | custom var `{{personalization}}` | `{{personalization}}`      |
| `evidence`        | All grounded reasons, `A \| B \| C`                    | custom var `{{evidence}}`        | custom var `{{evidence}}`  |
| `signals`         | The exact signal keys that grounded the draft, `k1;k2` | custom var `{{signals}}`         | custom var `{{signals}}`   |
| `predictedTier`   | `high` / `medium` / `low` personalization depth        | custom var — segment on it       | custom var — segment on it |
| `mailingAddress`  | Physical postal address (CAN-SPAM)                     | custom var — put in footer       | custom var — put in footer |
| `unsubscribeNote` | Mandatory unsubscribe instruction (CAN-SPAM)           | custom var — put in footer       | custom var — put in footer |

## Preset field mapping

### Instantly (Leads → Import CSV → Map columns)

```
email            → Email            (required)
company_name     → Company Name
phone            → Phone
website          → Website
personalization  → Custom Variable  personalization
evidence         → Custom Variable  evidence
signals          → Custom Variable  signals
sequenceStep     → Custom Variable  sequenceStep
mailingAddress   → Custom Variable  mailingAddress
unsubscribeNote  → Custom Variable  unsubscribeNote
```

Then in the sequence body, reference `{{personalization}}` for the opener hook
and put `{{mailingAddress}}` + `{{unsubscribeNote}}` in the email footer to stay
CAN-SPAM compliant.

### Smartlead (Leads → Upload → Map fields)

```
email            → Email            (required)
company_name     → Company
phone            → Phone Number
website          → Website
personalization  → Custom Field     personalization
evidence         → Custom Field     evidence
signals          → Custom Field     signals
mailingAddress   → Custom Field     mailingAddress
unsubscribeNote  → Custom Field     unsubscribeNote
```

Same footer rule: `{{mailingAddress}}` and `{{unsubscribeNote}}` belong in the
signature so the send is compliant.

## Using the evidence merge fields

The differentiator is that the draft is grounded in real signals, and those
signals travel with the row:

- `personalization` — the single sharpest hook, ready for a first line.
- `evidence` — the full grounded reason set, for a longer variant or a P.S.
- `signals` — the raw signal keys (e.g. `unanswered_negative;slow_site`), useful
  for **segmenting** a campaign (e.g. only send the review-management sequence to
  rows whose `signals` contains `unanswered_negative`).
- `predictedTier` — personalization depth; a common pattern is to send
  `high`-tier rows first / with a warmer sequence.

## Compliance reminders

- Keep `mailingAddress` + `unsubscribeNote` in the footer of every step.
- The export already refused any row without a postal address — do not re-add
  them manually.
- Mapsly does not verify inbox deliverability; run your sender's own
  bounce/warmup checks (SPF/DKIM/DMARC) before volume.
