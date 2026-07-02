# Data provenance & provider kill-switch (WP7-1)

> **Decision doc.** Procurement's first question about a data product is "where
> does the data come from, and what's your licensing story?" This records the
> provenance stance the product already ships, and the degradation behavior when
> any single data provider goes dark. **Viktor: confirm the "public sources only"
> framing + the graceful-degradation-over-hard-fail stance.**

## Provenance stance: public sources only, cited on every artifact

Every datum Mapsly surfaces is derived from **public sources** — the same
information a person could gather by hand, at scale. We do not resell a licensed
third-party contact database; we observe public listings, public websites,
public ad libraries, and public search results, then structure them.

**Every shared artifact carries the provenance line + disclaimer**, so a
prospect or a procurement reviewer sees exactly what they're looking at:

- The **Proof Pack one-pager** (`ProofPackSheet.tsx`, footer) and the public
  **`/s/[token]` share page** (same component, `poweredBy`) both render:
  > "Data via public sources (Google Maps & reviews, public websites, ad
  > libraries, search results) · retrieved {date} · prepared with Mapsly.
  > Signals are indicators from public data, not guarantees — verify anything
  > you plan to rely on before presenting it as fact."
- The **`retrieved {date}`** value is request-scoped (read at render on the
  authed report; from the share render on `/s/[token]`), so it's always honest.
- Per-block **"as of" dates** ride the drawer/one-pager evidence rows (WP6-9),
  and per-finding **confidence pills** cap how strongly a signal is stated
  (WP7-3 constitution: "indicators consistent with…", never "violates").

### Review text is never republished

A recurring licensing/defamation risk in this category is **republishing raw
review bodies**. Mapsly does not: **no artifact or export renders raw review
text.** The Proof Pack, the share page, and both CSV exports surface only
**structured review facts** — a numeric review count, the rating, and a
lifecycle label ("growing", "stalled"). There is therefore **no review snippet
to truncate** — the truncation risk WP7-1 guards against is designed out, not
mitigated after the fact.

- `ProofPackSheet.tsx` — reviews block shows `{count} · {rating}★ · {lifecycle}`.
- `modules/agency-portal/discover/leads-workbench.ts` `rowToCsvRecord` — the
  `reviews` column is a **count**, not bodies.
- `app/api/agency/research/[discoveryId]/export/route.ts` — same row model.

If a future feature ever surfaces review text (e.g. a "top complaint quote"),
it MUST truncate to a short snippet with attribution and re-open this doc.

## Provider dependency map

Each enrichment family reads from exactly one external provider (the on-site
families share one DOM fetch):

| Family        | Provider                                       | Basis    |
| ------------- | ---------------------------------------------- | -------- |
| `contacts`    | DOM scan of the business website (own fetcher) | per lead |
| `tech`        | DOM scan of the business website (own fetcher) | per lead |
| `services`    | AI read of the site + listing (OpenAI)         | per lead |
| `ai_research` | AI read of the site + listing (OpenAI)         | per lead |
| `reviews`     | **DataForSEO** Google reviews pull             | per lead |
| `lighthouse`  | On-page Lighthouse (DataForSEO / actor)        | per lead |
| `serp`        | **DataForSEO** Google search results           | per cell |
| `google_ads`  | Google Ads Transparency (via DataForSEO)       | per cell |
| `meta_ads`    | **Apify** Meta Ad Library actor                | per cell |
| discovery     | **DataForSEO** business_listings/search        | per cell |

Two providers carry the load: **DataForSEO** (discovery, reviews, SERP, Google
ads, Lighthouse) and **Apify** (Meta ad library). The on-site families
(`contacts`/`tech`) run on our **own DOM fetcher** behind the SSRF guard
(`lib/net/ssrf-guard.ts`), so they don't depend on a paid vendor.

## Kill-switch: what degrades if a provider dies

The design principle is **degrade gracefully, never hard-fail a whole run, never
bill for data that didn't land** (the WP1 money-path guarantees enforce this):

### If DataForSEO goes dark

- **Discovery** can't map new cells → a never-discovered market shows the honest
  "still mapping / couldn't map" state on Preview (`PreviewStep.tsx`), never a
  guessed number. **Already-discovered cells keep working** — they're served
  from the DB at $0 (30-day freshness), so most re-opens are unaffected.
- **`reviews` / `serp` / `google_ads` / `lighthouse`** families fail per-lead.
  Per the WP1-2 worker-outcome contract, a failed family is **non-billable**
  (`costUsd = 0`, marked FAILED/SKIPPED) and the held credits are **refunded**
  at settle. The run closes **PARTIAL** with the honest "enriched N of M · X
  couldn't complete · Y refunded" breakdown (`EnrichingStep.tsx` WP4-2), not a
  phantom OK. Contacts/tech/AI families still land (different provider).
- Retries + exponential backoff (WP3-6) ride out a transient blip before failing
  terminally; the stuck-job reset (WP1-8) prevents an infinite paid loop.

### If Apify goes dark

- Only the **`meta_ads`** cell family is affected. A failed `AdMarketRun` does
  **not** satisfy freshness (WP1-6: only `OK`/`PARTIAL` gate the 30-day cache)
  and does **not** bill (fan-out accrues cost only on `outcome === 'collected'`).
  The cell simply lacks Meta-ad signals until the next successful run; every
  other family is unaffected.

### If OpenAI goes dark

- Only `services` / `ai_research` and the touch-draft/polish passes degrade. The
  AI client is hardened (WP3-8: 30s timeout, jittered retry, token bucket);
  on hard failure the family is non-billable and refunded, and the lead still
  carries its structured (non-AI) evidence.

### Operator kill-switch

- To **stop a provider deliberately** (cost spike, vendor incident), unset its
  env credentials — the adapter degrades to the same non-billable-skip path as an
  outage (no code deploy needed). The worker route auto-falls back to the inline
  cron path when `BOXLY_WORKER_*` is unset (WP3-2), so throughput degrades but
  never stalls.
- No user-facing "provider down" banner is auto-shown today; the honest PARTIAL
  run state + the run-finished email (WP6-3) communicate the outcome. A
  first-class status banner is a reasonable follow-up if a provider outage ever
  becomes routine.

## The single procurement answer

> "Every field is derived from public sources — public listings, public
> websites, public ad libraries, public search results — cited with a retrieval
> date on every artifact. We don't republish review text. If a data provider is
> unavailable, the affected signals are skipped and refunded, never charged and
> never asserted as fact; the rest of the enrichment still lands."

## Anti-patterns

- ❌ Republishing raw review bodies on any artifact or export (structured facts only).
- ❌ Billing for a family whose provider failed (WP1-2 makes it non-billable + refunds).
- ❌ Closing a run OK when a provider outage dropped a family (WP1-4/WP4-2 → PARTIAL).
- ❌ A shared artifact without the provenance line + retrieved-date (WP7-1/7-3).
- ❌ Guessing a business count for a market discovery couldn't map (show the honest state).
