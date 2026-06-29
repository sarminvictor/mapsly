# Scraper scaling · the contact / DOM-enrichment playbook

How Mapsly turns 2.1M businesses into reachable, fingerprinted leads without
burning the API budget. This is the operating manual for the DOM-fetch +
contact-parse subsystem.

## Architecture · split the browser from the parser

The expensive, browser-only work and the cheap, pure work are **separated** so
each scales independently:

| Layer        | Where                                   | What it does                                                       | Cost |
| ------------ | --------------------------------------- | ------------------------------------------------------------------ | ---- |
| DOM fetcher  | `apify-actors/dom-fetcher/` (the actor) | Real browser + residential proxy · clears Cloudflare · returns DOM | paid |
| Adapter      | `services/dom-fetcher/`                 | Apify run transport · Zod input · cost-tracking · chunking         | —    |
| Parser       | `services/contact-scraper/`             | Pure: contacts, reachability, vendor-email filter                  | $0   |
| Tech         | `services/tech-fingerprint/`            | Pure: Wappalyzer-style tech detection over the same DOM            | $0   |
| Orchestrator | `modules/discovery/enrich-contacts.ts`  | Wires fetch → parse → persist (Contact + BusinessTech + Business)  | —    |
| Cron         | `app/api/cron/weekly/contact-enrich/`   | Bounded weekly batch · paid-cell-aware · freshness-deduped         | —    |

**The principle: one DOM → many enrichments.** A single rendered page feeds
contacts, the tech fingerprint, services extraction, and AI research. We pay for
the browser once and parse it many ways on our own backend. Never fetch the same
page twice for two different enrichments.

There is also a **free** path — a plain `fetch` (no JS, no proxy). The
orchestrator runs it FIRST for every target (`services/dom-fetcher/free-fetch.ts`
· `freeFetchDom`), and only the URLs a plain fetch can't get fall through to the
paid actor. See **Open-vs-walled routing** below. The paid actor is the
fallback, not the default.

## Measured costs (live-verified)

| Operation                               | Cost                                       |
| --------------------------------------- | ------------------------------------------ |
| Discovery (DataForSEO Maps)             | ~$0.04 per 100 leads                       |
| Contacts · per-lead basis (1 URL/run)   | ~$0.01 per lead                            |
| Contacts · batched (cell per run)       | ~$0.0027 per lead — roughly **6×** cheaper |
| Contacts · free plain-fetch (open site) | **$0** — ~70% of sites                     |
| Contacts · 512 MB (thrashing)           | ~180s / ~$0.019 per lead — **don't**       |
| Reviews (DataForSEO Standard queue)     | ~$0.015 per 200 reviews                    |
| Lighthouse · DataForSEO (open site)     | $0.00425 per audit — **junk on walled**    |
| Lighthouse · actor @ 4 GB (walled site) | ~$0.06 per run — on-demand only            |

> The Reviews **Live** endpoint is dead — use the **Standard queue**
> (`task_post` + `task_get`, ~$0.015/200, 45-min SLA).

The batched number is the one that matters at scale: amortizing the browser +
proxy session warm-up across a whole cell is the entire cost story. The free
plain-fetch first pass is the **biggest** win — it removes ~70% of leads from the
paid path entirely.

## Open-vs-walled routing · free-fetch-first

The orchestrator (`modules/discovery/enrich-contacts.ts`) is a two-pass funnel:

1. **Pass 1 · free.** `freeFetchDom(url)` does a plain `fetch` (desktop UA, 10s
   timeout, follows redirects) for EVERY target, with bounded concurrency. ~70%
   of SMB sites are open and return usable HTML for **$0**. A response is
   `blocked` (→ paid path) when it's a `403`/`503`, matches a Cloudflare/JS
   challenge interstitial (`just a moment`, `attention required`,
   `cf-browser-verification`, `checking your browser`, …), or the body is under
   ~500 bytes (empty shell). The classifier (`isBlockedResponse`) is pure +
   unit-tested — the whole saving rides on it not over- or under-blocking.
2. **Pass 2 · paid.** Only the `blocked` remainder is sent to `fetchDomsForCell`
   (the Apify actor). DOMs from both passes merge by URL and feed the same
   parse + persist. The result reports `freeFetched` + `actorFetched` counts.

`FAILED ≠ UNREACHABLE` still holds: a URL blocked by BOTH passes is
`contactScanStatus = FAILED`, never hidden (see **Dead-letter handling**).

## Memory → concurrency

Apify bills `memory × runtime`. Playwright + Chrome is memory-bound, so the
right memory tier is the difference between cheap and thrashing.

| Workload          | Memory | maxConcurrency | Notes                                      |
| ----------------- | ------ | -------------- | ------------------------------------------ |
| Single lead       | 1 GB   | 1–2            | Sweet spot. Fast, no thrash.               |
| Small cell (≤250) | 2 GB   | ~10            | The orchestrator's default batch.          |
| Large cell (~500) | 8 GB   | ~30–40         | Pass `memoryMbytes: 8192` explicitly.      |
| Actor Lighthouse  | 4 GB   | **1**          | Forced single-threaded. Walled sites only. |
| **Never**         | < 1 GB | —              | 512 MB thrashes to ~180s/$0.019 per lead.  |

Rule of thumb: **`maxConcurrency ≈ memoryGB`**. The actor recycles each browser
after `retireBrowserAfterPageCount` (20) pages so long runs don't leak memory.

All scale + cost constants live in **`services/dom-fetcher/scale.ts`** (the
single source): `DOM_CHUNK_SIZE = 250`, `DOM_MEMORY_MB` (`single 1024` ·
`batch 2048` · `bigCell 8192` · `lighthouse 4096`), `DOM_MAX_CONCURRENCY = 10`,
`CONTACTS_FRESHNESS_DAYS = 90`, `LIGHTHOUSE_FRESHNESS_DAYS = 30`,
`WALLED_LIGHTHOUSE_LIMIT = 10`, `DOM_RUN_COST_CEILING_USD = 10`,
`LIGHTHOUSE_RUN_COST_CEILING_USD = 2`. `fetcher.ts` re-exports `CHUNK_SIZE`,
`SINGLE_URL_MEMORY_MB`, `BATCH_MEMORY_MB` from there for back-compat.

## Batch a cell per run

The unit of work is a **discovery cell** (`category|city|country`, e.g.
`medical_spa|miami|US`) — not a single business.

- `fetchDomsForCell(urls)` chunks a cell's URL list into runs of `CHUNK_SIZE`
  (250) and calls the actor once per chunk, **sequentially**, so peak memory and
  Apify concurrency stay bounded.
- One run primes the browser/proxy once and loops every URL → the ~6× saving.
- Larger cells fan out across multiple sequential runs automatically.

Do **not** call the actor once per business in a loop — that pays the warm-up
cost N times and is the most common way to blow the budget.

## Freshness · dedup

Contacts are **fresh for 90 days** (`ENRICHMENT_PRICES.contacts.freshnessDays`).

- The orchestrator skips any business whose `Business.contactsExtractedAt` is
  within the window (`isFresh(...)` in `modules/discovery/enrich-fresh.ts`) and
  counts it as `skippedFresh` — **$0**, no fetch.
- The cron's SQL pre-filter selects the **stalest** rows first
  (`contactsExtractedAt ASC NULLS FIRST`) so the budget always goes to the
  businesses that need it most.
- We do **not** KV-cache the rendered HTML — it's far too large for KV; the
  90-day per-business freshness IS the dedup.

## Dead-letter handling

The actor emits a dead-letter item for any URL it couldn't clear:

```jsonc
{ "url": "…", "status": 403, "blocked": true, "failed": true, "error": "…" }
```

The orchestrator treats blocked/failed/no-html as **`contactScanStatus = FAILED`**
and **advances `contactsExtractedAt`** (we did attempt it — don't hammer it next
tick), but it does **NOT** hide the business and does **NOT** touch
`reachability`.

> **FAILED ≠ UNREACHABLE.** A block means "we know nothing", which is distinct
> from "we looked and found no way to reach them". Hiding on a transient
> Cloudflare block would silently delete reachable businesses from every list.
> Only a SUCCESSFUL parse with `reachableChannelCount === 0` may hide a business.

See `modules/contacts/reachability.ts` for the canonical statement of this rule.

## Vendor-email filtering

Website builders, hosts, and error trackers embed **their own** email addresses
in page markup (`webreporting@gargle.com`, `support@wixpress.com`,
`*@sentry.io`). Scraping those as the SMB's contact is a correctness bug — the
lead looks reachable but the inbox belongs to the vendor.

`services/contact-scraper/vendor-domains.ts` (`isVendorEmail`) drops vendor
domains, no-reply/automated mailers, and asset artefacts (`logo@2x.png`) before
they ever reach a Contact row. Keep the list **conservative** — over-blocking
drops real leads (a wrongly-dropped email looks like "no contacts found").

## Lighthouse is a DECOUPLED, optional enrichment

Lighthouse never rides the contacts DOM fetch. `enrich-contacts.ts` does NOT call
Lighthouse — a contacts pass must not silently trigger a $0.00425 (open) /
$0.06 (walled) audit. Lighthouse runs ONLY when a user (or a dedicated cron)
invokes `enrichLighthouseForBusinesses` (`modules/discovery/enrich-lighthouse.ts`).

Its own open-vs-walled routing:

- **Open site → DataForSEO** (`lighthouseAudit`, $0.00425). Cheap, bulk-safe.
- **Walled site → actor** (`fetchLighthouse`, ~$0.06 @ 4 GB, maxConcurrency 1).
  On Cloudflare sites the DfS audit hits the **challenge page** — HTTP 403,
  `is-crawlable` failed ("blocked from indexing"), SEO≈40 + meta-refresh — which
  is junk. We detect that signature (`isChallengeResult`) and pay for a real
  browser instead. Walled actor runs are **HARD-CAPPED** per invocation
  (`WALLED_LIGHTHOUSE_LIMIT`, default 10) — they are NEVER bulk; overflow is
  counted (`skippedWalledOverCap`) for a later, deliberate pass.

We pre-classify from the stored contact signal to skip the DfS probe when we
already know: a `FAILED` contact scan ⇒ walled (the DOM-fetcher couldn't clear
Cloudflare); an `OK` scan ⇒ open. Everything else probes with the cheap DfS
audit and detects the challenge live. Persisted to a `LighthouseAudit` row with
`formFactor = "mobile"` + a `rawJson` source marker (`{ source, walled }`).

## Per-run cost ceiling

Both orchestrators stop spending at a cumulative ceiling — **never silently**:

- `fetchDomsForCell({ maxUsageUsd })` (default `DOM_RUN_COST_CEILING_USD = 10`)
  stops launching chunks once running Apify usage reaches the ceiling and logs a
  structured `cost-ceiling.hit` with the dropped chunk/URL count.
- `enrichLighthouseForBusinesses({ maxUsageUsd })` (default
  `LIGHTHOUSE_RUN_COST_CEILING_USD = 2`) stops further actor spend the same way.

The walled cap is the primary Lighthouse guard; the ceiling is belt-and-braces.

## Budget guard

- Every Apify run bills its **actual** metered usage (`run.stats.usageTotalUsd`)
  to the open `CronRun.costUsd` — there is no fixed per-call charge layered on
  top (`withCostCounter("dom-fetcher.fetch", 0, …)`).
- The cron is **bounded**: `CRON_WEEKLY_CONTACT_LIMIT` (default 50, max 250) caps
  businesses per run. Raise it deliberately for a backfill; don't leave it high.
- The per-run cost ceilings (above) cap a single invocation regardless of the
  business count.
- The $5-per-single-call ceiling (`.claude/rules/cost-discipline.md`) applies —
  a 250-URL batch at ~$0.0027/lead is well under it, but a misconfigured
  large-memory run is the thing to watch. Sentry alerts on
  `CronRun.costUsd > 5×` expected.

## Batched DB writes

The contacts orchestrator writes ~2–3 statements per business in ONE
`$transaction`, not the old N+1 per-row upsert/find loop:

- `contact.createMany({ skipDuplicates: true })` — the
  `@@unique([businessId, channel, normalizedValue])` makes a re-scan a no-op for
  existing rows (they keep their original `isPrimary` + `firstSeenAt`; the
  confidence/`lastSeenAt` refresh is intentionally dropped — non-critical).
- `businessTech` delete-then-`createMany` — `BusinessTech` has no `@@unique`, so
  the set is replaced each scan (idempotent: same DOM → same rows).

## NEXT · async job + SSE for user-triggered 1,400-lead enrichment

The current path is **synchronous** — the orchestrator fetches + parses + writes
inline within a single request/cron invocation. That's fine for the **scheduled
cron-batch** (bounded to ≤250 businesses/run) but it's capped by the **300s
Vercel function limit**: a user-triggered 1,400-lead enrichment (free pass + a
walled actor remainder + per-business writes) will not finish in one request.

The scale path is a **background job + SSE progress stream**:

- Enqueue the enrichment (Vercel Queues / Workflow, or Inngest per
  `.claude/rules/scalability.md` §Queueing) instead of running it in the request.
- The worker processes the cell in bounded chunks, billing each to its CronRun,
  honoring the same free-first routing + cost ceilings.
- The UI subscribes to an SSE channel (`.claude/rules/realtime-and-optimistic.md`)
  for live `freeFetched` / `actorFetched` / `audited` progress.

Until then: keep user-triggered enrichment bounded, or route it through the cron.
Do NOT raise `CRON_WEEKLY_CONTACT_LIMIT` to thousands — that's what the async
job is for.

## Next step · persist the rendered DOM for reuse

Today each enrichment family re-runs over the DOM **in the same pass**
(contacts + tech share one fetch in the orchestrator). The next step is to
**persist the rendered HTML to Vercel Blob** (90-day TTL, like reports) keyed by
business so a _later_ services-extraction or AI-research pass can reuse the same
bytes without paying for another browser run. That fully realizes "fetch once,
reuse everywhere" across enrichment families, not just within one orchestrator
pass. (Deferred — not in this subsystem.)
