# Cache setup · Redis (any provider)

The `lib/cache` module (used by `services/ai/extract-entities`, `services/ai/reply-draft`, `services/dataforseo/*`, etc.) opportunistically dedups identical calls for 24h. Without a configured cache backend, every call hits the upstream API · costs more, slower responses.

If you see this warning in Vercel logs:

```
[lib/cache] cache not configured (no REDIS_URL / KV_REST_API_URL) — running uncached.
Provision Redis from the Vercel Marketplace (sets REDIS_URL automatically)
or set KV_WARN_DISABLED=1 to silence. Logs once per process.
```

We support **two transports**, picked automatically per env. You only need ONE.

## Transport A · `REDIS_URL` (preferred, lower latency)

This is what most Vercel Marketplace Redis integrations (Upstash Redis, Redis Cloud, Render Redis, self-hosted) expose. The connection string looks like `rediss://default:<password>@<host>:<port>`.

Detected in `lib/cache/kv.ts`:

```ts
if (isRedisUrlConfigured()) {
  return createRedisKvClient(); // ioredis-backed
}
```

Backed by `ioredis` with lazy connect, 1-retry-per-request, and offline queue disabled — connection errors fall through to upstream rather than hang.

## Transport B · `KV_REST_API_URL` + `KV_REST_API_TOKEN`

The HTTPS REST endpoint used by `@vercel/kv`. Slower than direct Redis (extra HTTP hop) but works in edge-only runtimes where TCP sockets aren't available. Picked automatically when `REDIS_URL` is unset but `KV_REST_API_URL` is.

If BOTH are set, `REDIS_URL` wins (lower latency).

## Provisioning · Vercel Marketplace

1. Open the Vercel dashboard → project `mapsly` → **Storage** tab
2. Click **Connect Database** → **Marketplace** → pick **Upstash Redis** (free tier 10k cmds/day) or **Redis Cloud**
3. Provision the integration · Vercel auto-injects across all environments:
   - `REDIS_URL` (rediss:// · what we prefer)
   - And/or `KV_REST_API_URL` + `KV_REST_API_TOKEN` (the REST endpoint, for older bindings)
4. Redeploy · the next cold start picks up the env and the cache becomes active
5. Verify · run any cron + grep `[lib/cache]` in Vercel logs — the warning should be gone, and cache hits accrue to `CronRun.meta.cacheHits`

Per Vercel's 2026 changes, **Vercel KV is no longer offered**; storage now lives in the Marketplace. Both Upstash and Redis Cloud are drop-in.

## Escape hatch · silence the warning when not provisioning Redis yet

When you've decided the cache isn't worth provisioning yet (early product, low call volume), set on Vercel:

```bash
vercel env add KV_WARN_DISABLED production
# value: 1
```

The cache layer continues to fall through (every call hits upstream); the warning stops logging. Use this as a temporary measure · the AI cost savings from cache hits typically pay for the Redis tier many times over once review volume picks up.

## Connection failure semantics

When Redis is configured but the connection fails (network blip, provider outage):

- `ioredis` connection event-emits an error · we log a warning, swallow at the EventEmitter level
- The next `get`/`set` call rejects → `lib/cache/index.ts` catches → falls through to the upstream fn
- **Cache failure NEVER breaks the request path.** This is by design: caching is an optimization, not a load-bearing dependency.

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

- ❌ Hard-coding `process.env.KV_REST_API_URL` / `REDIS_URL` outside `lib/cache/kv.ts` — that file is the single source of truth for transport selection.
- ❌ Conditionally importing `@vercel/kv` or `ioredis` at module top level — both are wrapped behind lazy Proxies (`getKv()` + `createRedisKvClient()`) to avoid import-time env reads (INC-07).
- ❌ Adding a third Redis client. We've intentionally settled on `ioredis` for direct rediss:// + `@vercel/kv` for REST · adding a fourth (say, `node-redis`) without removing one fragments the abstraction.
- ❌ Treating cache failure as fatal · the wrapper falls through to upstream on every error. Don't add code that throws when KV is missing.
