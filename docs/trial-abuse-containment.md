# Trial-abuse containment (WP7-5)

> How the free tier stays open (no card required to try) without becoming a
> free-contact-data farm. Four independent controls, none of which requires a
> card. Pairs with `docs/seat-model.md` (free = 1 seat) and
> `docs/opt-out-and-drop-registration.md`.

## The threat model

The abuse vector is the **free-credit grant**, not re-enrichment cost. Each new
agency gets a one-time 50-credit grant (`grantFreeTierIfNew`, idempotent per
agency). An attacker who can mint agencies freely can farm those grants for
resaleable contact data. So the controls target: (a) how easily agencies are
minted, (b) how fast runs can be created, and (c) whether the farmed data can
actually leave the product.

## Control 1 · Market-cell result caching serves $0 (verified, no farming lever)

Re-enriching an already-enriched cell is served from the DB at **$0** via the
freshness gates:

- `dispatch.fanOutRun` marks a fresh cell `SKIPPED_FRESH` and does not re-charge
  or re-call the vendor (freshness `unitFreshAtProcess`).
- `freshness.ts` only counts `OK`/`PARTIAL` AdMarketRuns as fresh, and the
  30-day `freshnessDays` window gates cells to $0.

So **re-enriching costs the attacker nothing AND yields nothing new** — the data
is the same rows already in the DB. Re-enrichment is therefore NOT a farming
lever; the free-credit grant is. Controls 2–4 target the grant + the data exit.

## Control 2 · Disposable-email blocklist at signup

`modules/agency-portal/disposable-domains.ts` (`isDisposableEmailDomain`) blocks
the well-known throwaway providers (Mailinator, Guerrilla Mail, 10MinuteMail,
YOPmail, …, incl. subdomains) at agency provisioning
(`provisionAgencyForUser`). A disposable-domain signup gets **no agency and no
free grant** — it's bounced to `/for-agencies?signup=business_email_required`
and an `agency_provision_blocked` ProductEvent is logged.

Real agencies on Gmail/Outlook/branded domains are NOT disposable and pass — the
door stays open for legitimate free trials. This is a heuristic list, not an
exhaustive DEA feed; a DEA service can slot behind the same seam later (no new
paid vendor was added for MVP).

## Control 3 · Free tier is scoped — contacts don't leave in the CSV until paid

Contacts (emails/phones) are visible **in-app** (lead drawer, workbench) on
every plan — that's the value proof. But the **CSV-with-contacts export is a
paid feature**: the server export route
(`app/api/agency/research/[discoveryId]/export/route.ts`) checks
`isPaidAgency(stripeStatus)` and, for a Free agency, keeps the contact columns
(stable shape) but **blanks their values**. The `reachable` flag still reflects
the real `reachableChannelCount`, so the wall is honest ("contacts exist, behind
the paywall") without handing the data over.

This is the natural upgrade wall: Tom can see the leads and evaluate them for
free, but exporting the contacts into his sending tool requires a paid plan.
_(Follow-up: the client-side per-page `exportCsv` in the workbench isn't yet
gated — the authoritative full "Export all N" streams through the gated server
route; the client export is bounded to the visible page. Gate it on the plan
when the plan is threaded to the workbench client.)_

## Control 4 · Rate limits on run creation

Two independent Upstash sliding-window caps on enrich-run creation, both
fail-soft (KV down → allow), returning the standard `rate_limited` shape:

- **Per user** — `ACTION_ENQUEUE_LIMIT` (10/min/user) on `runEnrichAction`,
  `preflightEnrichAction`, `runDiscoveryAction`, touch generation, polish, and
  checkout starts (WP8-2).
- **Per IP** — `ENRICH_RUN_IP_LIMIT` (20/min/IP) on `runEnrichAction`
  specifically, keyed off `x-forwarded-for` via `headers()`. This blunts
  **account-rotation** farming (many free accounts behind one IP), which the
  per-user cap alone can't see.

## Explicitly NOT required: a card for the trial

Per the WP7-5 spec, the free tier does **not** require a credit card. The
controls above raise the cost of farming without taxing legitimate trials — a
real agency reaches first value on 50 free credits with no card, and only hits a
wall when it tries to EXPORT contacts (Control 3) or mint runs abusively fast
(Control 4).

## Anti-patterns

- ❌ Requiring a card to try (kills legitimate top-of-funnel).
- ❌ Blocking Gmail/Outlook as "not a business domain" (most solo agencies use
  them — only DISPOSABLE providers are blocked).
- ❌ Charging for re-enrichment (it's $0 by design and yields nothing new —
  charging would punish legitimate re-opens without stopping any abuse).
- ❌ Hiding contacts in-app (the value proof must be visible; only the EXPORT is
  walled).
