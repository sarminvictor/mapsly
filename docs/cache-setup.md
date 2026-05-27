# Cache setup · Upstash Redis via Vercel Marketplace

The `lib/cache` module (used by `services/ai/extract-entities`, `services/ai/reply-draft`, `services/dataforseo/*`, etc.) opportunistically dedups identical calls for 24h. Without a configured cache backend, every call hits the upstream API · costs more, slower responses.

If you see this warning in Vercel logs:

```
[lib/cache] KV not configured (no KV_REST_API_URL / KV_URL) — running uncached.
Install Upstash Redis from the Vercel Marketplace to enable 24h dedup,
or set KV_WARN_DISABLED=1 to silence this warning. Logs once per process.
```

Pick one of two paths:

## Option A · Install Upstash Redis (recommended)

Per Vercel's 2026 changes, **Vercel KV is no longer offered**; storage now lives in the Vercel Marketplace. Upstash Redis is the drop-in replacement and works with the existing `@vercel/kv` SDK we already depend on.

1. Open the Vercel dashboard → project `mapsly` → **Storage** tab
2. Click **Connect Database** → **Marketplace** → **Upstash Redis** (free tier is fine for v0)
3. Provision the integration · Vercel auto-injects these env vars across all environments:
   - `KV_REST_API_URL` (canonical · what we check in `lib/cache/kv.ts`)
   - `KV_REST_API_TOKEN` (write token)
   - `KV_REST_API_READ_ONLY_TOKEN` (read-only token)
   - `KV_URL` (rediss:// connection string, optional)
4. Redeploy · the next cold start picks up the env and the cache becomes active
5. Verify · run any cron + grep `[lib/cache]` in Vercel logs — the warning should be gone, and cache hits accrue to `CronRun.meta.cacheHits`

**Free tier limits (Upstash):** 10k commands/day, 256 MB. Plenty for our 6h–24h dedup on AI extracts + DfS responses.

## Option B · Silence the warning (no cache)

When you've decided the cache isn't worth provisioning yet (early product, low call volume), set on Vercel:

```bash
vercel env add KV_WARN_DISABLED production
# value: 1
```

The cache layer continues to fall through (every call hits upstream); the warning stops logging. Use this as a temporary measure · the AI cost savings from cache hits typically pay for the Upstash tier many times over once review volume picks up.

## What gets cached

| Caller                                                                           | TTL | Key shape                                     |
| -------------------------------------------------------------------------------- | --- | --------------------------------------------- |
| `services/ai/extract-entities` · NER + service mentions                          | 24h | `ai:entities:extract:v2:<sha-of-review-text>` |
| `services/ai/reply-draft` · bilingual owner-reply drafts                         | 6h  | `ai:reply:draft:<sha-of-input>`               |
| `services/ai/sentiment` · review sentiment classifier (legacy, unused after R.1) | 24h | `ai:sentiment:<sha>`                          |
| `services/dataforseo/maps-search` · Maps category search                         | 24h | `dataforseo:maps:search:<sha>`                |
| `services/dataforseo/serp-organic` · SERP organic results                        | 6h  | `dataforseo:serp:organic:<sha>`               |
| `services/dataforseo/serp-local-pack` · 3-pack                                   | 6h  | `dataforseo:serp:localpack:<sha>`             |
| `services/dataforseo/keyword-volume` · search volume batch                       | 7d  | `dataforseo:keyword:volume:<sha>`             |
| `services/dataforseo/lighthouse` · audit                                         | 24h | `dataforseo:lighthouse:<sha>`                 |
| `services/email-verify/smtp` · SMTP RCPT probe                                   | 7d  | `email:smtp:verify:<sha>`                     |
| `services/meta-ad-library/ads-archive` · ad search                               | 6h  | `meta:ads:search:<sha>`                       |
| `services/lighthouse/audit` · full mobile + desktop                              | 24h | `lighthouse:audit:<sha>`                      |

Reviews task pull (`services/dataforseo/reviews-task`) does **not** use kvCache — it's a one-shot pingback flow guarded by `Business.pendingReviewsTaskId` so duplicates are prevented at the DB layer instead.

## Anti-patterns

- ❌ Hard-coding `process.env.KV_REST_API_URL` outside `lib/cache/kv.ts` — that file is the single source of truth.
- ❌ Conditionally importing `@vercel/kv` at module top level — the wrapper's lazy Proxy avoids the import-time crash (see INC-07).
- ❌ Pulling in a separate Redis library when Upstash + `@vercel/kv` already covers the use case.
