# Mapsly DOM Fetcher (`dom-fetcher`)

A minimal **Cloudflare-busting DOM fetcher**, published to Apify and consumed by
the app via `services/dom-fetcher/`.

It does the ONE thing that genuinely needs a real browser + a residential proxy:
**navigate, clear the Cloudflare JS challenge, and return the fully-rendered
HTML.** Every downstream parse — contacts, tech fingerprint, services
extraction, AI research — happens on _our_ backend over that single DOM. One
fetch, many enrichments.

This is deliberately the opposite of the plain-`fetch` path in
`modules/contacts/fetch-site.ts`: that one is free and fast but can't execute JS
or pass a WAF. This actor is the paid fallback for the (sizable) slice of SMB
sites behind Cloudflare or rendered client-side.

## Deployed actor

| Field | Value                                   |
| ----- | --------------------------------------- |
| Actor | `mapsly-contact-scraper`                |
| ID    | `VQmuafAxGueqPgCey`                     |
| Owner | `formidable_embargo`                    |
| Base  | `apify/actor-node-playwright-chrome:22` |

The app references the actor by id in `services/dom-fetcher/fetcher.ts`
(`DOM_FETCHER_ACTOR_ID`). Override per-fork via that constant — there is no env
var for it (it's a published-actor id, not a secret).

## Deploy

From this directory, with the Apify CLI authenticated (`apify login`):

```bash
cd apify-actors/dom-fetcher
apify push
```

`apify push` reads `.actor/actor.json`, builds the Docker image, and publishes a
new build under `buildTag: latest`. `node_modules` is intentionally **not**
committed — the Dockerfile installs deps at build time.

## Input

```jsonc
{
  "url": "https://example.com", // single page, OR
  "urls": ["https://a.com", "https://b.com"], // batch a whole cell in one run
  "country": "US", // residential proxy country code
  "cfWaitMs": 14000, // max wait for the JS challenge to clear
  "maxConcurrency": 10, // parallel browsers (~1 per GB of run memory)
  "retireBrowserAfterPageCount": 20, // recycle browsers → no memory leaks
}
```

Pass `urls` (not `url`) to amortize the browser warm-up across a whole discovery
cell — that's where the ~6× cost saving comes from (see below).

## Output

One dataset item per URL.

**Success:**

```jsonc
{
  "url": "https://example.com",
  "finalUrl": "https://example.com/",
  "status": 200,
  "title": "Example Spa",
  "blocked": false,
  "htmlBytes": 84213,
  "html": "<!doctype html>…", // the rendered DOM — the only product
}
```

**Dead-letter** (Cloudflare not cleared after retries, navigation failure, etc.):

```jsonc
{
  "url": "https://blocked.example",
  "status": 403,
  "blocked": true,
  "failed": true,
  "error": "Cloudflare not cleared — retry new session/proxy",
}
```

The backend treats a dead-letter as `contactScanStatus = FAILED` — **never** as
`UNREACHABLE` (FAILED means "we know nothing", which is distinct from "no
contacts found"; see `modules/contacts/reachability.ts`).

A run-level `SUMMARY` (`{ total, failed, failedUrls }`) is written to the run's
default key-value store for quick triage.

## Cost (measured)

| Mode                              | Cost                                   |
| --------------------------------- | -------------------------------------- |
| Single lead (1 URL/run)           | ~$0.003–0.013 per lead                 |
| Batched (a whole cell in one run) | ~$0.0027/lead — roughly **6× cheaper** |

The win is amortizing the heavy browser warm-up (Playwright + Chrome + proxy
session) over many pages in one run instead of paying it per lead.

## Memory guidance

Apify bills by `memory × runtime`, and Playwright+Chrome is memory-hungry.

| Workload       | Memory     | Notes                                            |
| -------------- | ---------- | ------------------------------------------------ |
| Single lead    | **1 GB**   | The sweet spot — fast, cheap, no thrash.         |
| 500-lead batch | **8 GB**   | Enough headroom for `maxConcurrency` browsers.   |
| Never          | **< 1 GB** | 512 MB **thrashes** to ~180s / ~$0.019 per lead. |

Rule of thumb: `maxConcurrency ≈ memoryGB`. The actor recycles each browser
after `retireBrowserAfterPageCount` pages so long runs don't leak.

See `docs/scraper-scaling.md` for the full memory→concurrency table and the
"batch-a-cell-per-run" playbook.
