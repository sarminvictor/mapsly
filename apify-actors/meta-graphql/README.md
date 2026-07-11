# mapsly-meta-graphql · Meta Ad Library, GraphQL-direct

HTTP-direct rebuild of `mapsly-meta-ad-library`. Same input + dataset contract, radically cheaper transport.

## Why

The prior actor navigated **every target's** Ad Library page with **images on** on a residential proxy. In production that failed **73%** of runs and a dead run burned **up to $0.90** of residential bandwidth over a 280 s timeout for zero yield (~93% of the cost is proxy bytes). See `docs/meta-actor-forensics-2026-07-10.html`.

## How ("browser to mint, HTTP to harvest")

1. **Prime once** — one browser render of the first target's _public_ Ad Library page to mint `datr` + `lsd` + `doc_id` (harvested fresh every run — never hardcoded; `doc_id` rotates per Meta JS-bundle deploy).
2. **Harvest over HTTP** — fire the `/api/graphql` persisted-query POST via `page.request.post` for every target. It rides the **real browser TLS/JA3 fingerprint** + primed cookies (Meta's WAF scores TLS before render) but sends only a few KB of JSON — no per-target navigation, no images.
3. **Fast-fail** — a block is knowable in one ~1 KB request, so a bad session is abandoned after 3 consecutive blocks (`MAX_CONSECUTIVE_BLOCKS`) and a run can't grind past `RUN_WALL_BUDGET_MS` (210 s).
4. **Fallback** — only if the direct POST can't run (creds stale) does a single target fall back to a navigation-intercept, which also re-harvests creds.

## Contract (drop-in)

Emits the identical dataset records the app adapter already parses — flat ad rows + `recordType: resolution | advertiser | target_status` — plus a machine-readable `RUN_SUMMARY` KV record with the honest `ok / empty_verified / partial / blocked / timeout` taxonomy. **New observability:** each target reports its `mode` (`http-direct` | `intercept-fallback`) and `elapsedMs`; `RUN_SUMMARY` carries `credsMinted`, `docId`, and a `modeMix`.

Adopt by pointing `META_AD_LIBRARY_ACTOR_ID` at this actor's id — no adapter change.

## Structural truth

Keyword/cell searches yield the advertiser **facet**; ad **creatives** come only from the per-page-id path. No transport change alters this.
