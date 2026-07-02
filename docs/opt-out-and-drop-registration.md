# Opt-out, suppression & DROP registration (WP7-2)

> **Decision + operating note** for the do-not-sell / suppression flow and the
> California Delete Act (DROP) obligation. Pairs with the churn-offboarding and
> i18n-Canada decisions (US + Canada are live markets).

## The public opt-out flow (shipped)

- **`/opt-out`** (locale-agnostic, no-index, IP-rate-limited) — a business owner
  enters their email. We do NOT suppress on submit; instead we email an HMAC
  verification link (`modules/opt-out/token.ts`, domain-separated with an
  `optout:` prefix from the cold `/u` and `/o` tokens). Control of the inbox is
  the proof — a stranger can't opt out a business they don't own.
- **`/opt-out/[token]`** — the confirmation link. GET shows a confirm card and
  NEVER writes (scanner-safe, same invariant as `/u/[token]` — email security
  gateways GET every link). POST verifies the token and calls
  `suppressByEmail(email)`.
- **`suppressByEmail`** (`modules/opt-out/suppress.ts`) sets
  `Business.suppressedAt` on every business that owns a matching EMAIL contact or
  whose own `email` field is the address, and `Contact.optedOutAt` on the
  matching EMAIL contacts. Idempotent (only NULL rows are touched).

## Enforcement (the read chokepoints)

Suppression is enforced at the places data LEAVES the product, not just at write:

| Surface                                     | Where enforced                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Workbench, Preview, enrich-scope resolution | `rawListWhere` adds `suppressedAt: null` (single chokepoint — `modules/discovery/raw-list.ts`)                                              |
| CSV / full-set export (discovery scope)     | rides `rawListWhere` via `listWhere`                                                                                                        |
| CSV export (saved-list scope)               | `fetchListBatch` filters `business.suppressedAt: null`                                                                                      |
| Exported contacts                           | `optedOutAt: null` on the export contact query                                                                                              |
| Lead drawer / one-pager / public share      | `getLeadDetail` returns null for a suppressed business + `optedOutAt: null` on its contacts                                                 |
| Touch generation                            | pool query filters `suppressedAt: null`; `getLeadDetail`/pool feed it                                                                       |
| Enrichment fan-out                          | `dispatch.fanOutRun` drops suppressed ids from the job-mint gate (defense in depth for a business suppressed between preflight and fan-out) |

Suppression is **unconditional** — there is no `includeSuppressed` toggle. A
`suppressedAt` set is a legal opt-out, not a view preference. `includeHidden` /
`includeClosed` never drop it.

## DROP registration (California Delete Act) — the obligation

California's **Delete Act** (SB 362) requires data brokers to register with the
CPPA and, from the **DROP** (Delete Request and Opt-out Platform) go-live
(**enforcement August 2026**), to honor consumer deletion requests submitted
through DROP — a single request that must propagate to every registered broker.

**Where Mapsly stands:**

1. **Are we a "data broker"?** Mapsly sells local-business intelligence, largely
   from public sources. Business-contact data about a sole proprietor can be
   personal information under the CCPA, so we treat the broker analysis as
   **live, not settled** — the conservative default is to build the machinery
   now (this WP7-2 flow) so registration + DROP intake is a config step, not a
   re-architecture.
2. **What DROP needs from us when we register:** a mechanism to accept a batch of
   opt-out identifiers (emails) and suppress them within the statutory window.
   The `suppressByEmail` helper is exactly that primitive — a DROP intake cron
   (future) iterates the DROP export and calls it per email; no new suppression
   logic is required.
3. **Retention:** suppression is permanent (a `suppressedAt` timestamp, never
   cleared by the retention sweep). See `.claude/rules` + the retention cron
   (WP9-1) — the sweep is age-based and tenant-agnostic and does NOT resurrect
   suppressed rows.

**Action items (tracked, not yet done):**

- [ ] Confirm broker classification with counsel before the Aug-2026 DROP
      enforcement date; if in scope, register with the CPPA.
- [ ] Add a DROP-intake cron that pulls the DROP deletion export and calls
      `suppressByEmail` per identifier (reuses the shipped primitive).
- [ ] Surface an opt-out link in shared artifacts (one-pager / share page footer)
      once counsel confirms the placement wording.

## Canada (PIPEDA / CASL)

Canada is a live market. PIPEDA gives individuals a right to withdraw consent;
the same `/opt-out` flow + `suppressByEmail` serve it. CASL consent for OUTBOUND
email is handled separately in WP7-4 (the outbound-compliance co-pilot).

## Anti-patterns

- ❌ Suppressing on form submit without email verification (lets a stranger
  opt out someone else's business).
- ❌ A GET that writes the suppression (email scanners would mass-suppress).
- ❌ An `includeSuppressed` toggle anywhere (a legal opt-out is not a view).
- ❌ The retention sweep clearing `suppressedAt` (suppression is permanent).
