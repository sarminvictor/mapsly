---
description: Layered caching strategy. Tags are mandatory. Auto-loaded everywhere.
globs: ["**/*.ts", "**/*.tsx"]
alwaysApply: true
---

# Caching

Three layers. Each has rules. **Untagged caches are forbidden.**

## Layer 1 · Next.js Data Cache (`use cache` + `cacheTag`)

The default. Used for any pure server function whose output depends on inputs.

```ts
"use cache";
import { cacheLife, cacheTag } from "next/cache";

export async function getList(listId: string) {
  cacheLife("hours");
  cacheTag(`list-${listId}`);
  // ...
}
```

**Rules:**

- Every `'use cache'` function declares BOTH `cacheLife` and `cacheTag`.
- `cacheLife` profiles (defined in `next.config.ts`):
  - `seconds` — 10s · for fast-changing dashboards
  - `minutes` — 5min · for hot reads (lists overview)
  - `hours` — 1h · for slow-changing aggregates
  - `days` — 24h · for almost-static data (business profiles)
  - `weeks` — 7d · for static reference data
  - `max` — 1yr · for true constants (signal registry definitions)
- Pick the **most generous** profile consistent with how often the data actually changes. Aggressive caching is the rule.

## Layer 2 · Vercel KV (Redis) for API adapter cache

Used by `services/{vendor}` adapters to dedup external API calls.

```ts
import { kvCache } from "@/lib/cache/kv";

export const dataforSeoMapsSearch = kvCache(
  "dfs:maps:search",
  { ttl: 86400 }, // 24h
  async (params: SearchParams) => {
    return await rawCall(params);
  },
);
```

**Rules:**

- TTL is **always explicit**. No default ≥ 24h without explicit reason.
- Cache key format: `{vendor}:{operation}:{stable-hash-of-params}`.
- Cache hits are tracked in `CronRun.meta.cacheHits` for cost-audit reporting.
- Invalidation strategy: time-based only. Tags don't apply here.

## Layer 3 · Database snapshots

`BusinessSnapshot`, `LighthouseAudit`, `SerpResult`, etc. are themselves caches — they store the result of weekly cron jobs so user requests never trigger live calls.

**Rules:**

- User request path reads from these tables — never from external APIs.
- "Latest snapshot" pattern: `findFirst` ordered by `snapshotDate desc`.
- Don't rebuild snapshots in user routes. Only cron jobs write here.

## Revalidation

After a cron job updates a business's data:

```ts
import { revalidateTag } from "next/cache";

// In the cron handler, after writing the snapshot
revalidateTag(`business-${business.slug}`, "days");
revalidateTag(`business-${business.slug}-reviews`, "days");
revalidateTag(`agency-${agencyId}`, "days"); // if cascade applies
```

**Rules:**

- Revalidate **granular** tags, not broad ones. Don't `revalidateTag('businesses')` if you can revalidate one.
- Always pass the second arg (cacheLife profile) so Next knows the new validity horizon.
- Revalidate happens in cron handler AFTER the DB write succeeds. Rollback on revalidate failure is fine — next read will hit the new data anyway.

## Tag taxonomy

| Tag pattern                   | Owner              | When to revalidate                                                    |
| ----------------------------- | ------------------ | --------------------------------------------------------------------- |
| `business-${slug}`            | weekly cron        | After weekly snapshot write                                           |
| `business-${slug}-reviews`    | daily cron         | After new-reviews-delta                                               |
| `business-${slug}-lighthouse` | weekly cron        | After lighthouse-audit                                                |
| `list-${id}`                  | list-refresh cron  | After list-refresh                                                    |
| `list-${id}-full`             | list-refresh cron  | After list-refresh                                                    |
| `lead-${id}`                  | user action        | After status change                                                   |
| `agency-${id}`                | aggregator         | After any list refresh                                                |
| `agency-${id}-analytics`      | weekly             | After list-refresh cron                                               |
| `kw-${id}`                    | weekly cron        | After serp-rank-scan                                                  |
| `marketing`                   | manual             | On copy update                                                        |
| `biz-sitemap`                 | discovery pipeline | After discovery adds businesses (`modules/business-discovery/run.ts`) |
| `user-${id}`                  | user action        | After settings change                                                 |

## Anti-patterns

- ❌ `'use cache'` without `cacheTag` — un-revalidatable
- ❌ Broad tag like `'all-businesses'` — kills cache hit rate on revalidate
- ❌ TTL-only cache where tag would work — leads to stale-but-not-yet-expired data
- ❌ Caching user-specific data globally — leaks data across users
- ❌ `revalidatePath` for anything user-facing — use tags
- ❌ Multiple revalidates in a loop (batch them by tag prefix instead)

## When to skip caching

- **Auth-gated personalized data:** `noStore()` at top of the function.
- **Realtime user input:** server actions with optimistic updates, no cache.
- **Webhooks:** never cache the response, always read fresh.
- **Admin internal tools:** caching is overhead, skip.

```ts
import { unstable_noStore as noStore } from "next/cache";

export async function getMyDashboard() {
  noStore();
  const session = await auth();
  // ...
}
```

## Performance checks

- Page TTFB < 200ms p50 in production
- Cache hit rate > 80% on cacheable reads (visible in Vercel dashboard)
- No "rendered without cache" warnings in dev console
