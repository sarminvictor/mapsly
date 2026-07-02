# Caching · three layers, all tagged

Three layers. Each has rules. **Untagged caches are forbidden** — untagged = unrevalidatable = stale forever.

## Layer 1 · Next.js Data Cache (`use cache` + `cacheTag`)

The default for any pure server function whose output depends on inputs.

```ts
"use cache";
import { cacheLife, cacheTag } from "next/cache";

export async function getCollection(id: string) {
  cacheLife("hours");
  cacheTag(`collection-${id}`);
  // ...
}
```

**Rules:**

- Every `'use cache'` function declares BOTH `cacheLife` and `cacheTag`.
- Use `'use cache: remote'` when the cache must be shared across serverless instances / survive deploys (SEO + marketplace-style pages backed by a remote cache store); plain `'use cache'` otherwise.
- `cacheLife` profiles are defined in `next.config.ts`. Convention: `seconds` (10s, hot dashboards) · `minutes` (5m, hot reads) · `hours` (1h, aggregates) · `days` (24h, near-static) · `weeks` (7d, reference data) · `max` (1yr, constants). Pick the **most generous** profile consistent with how often the data actually changes.
- Prisma results inside `'use cache'` need `serialize()` (`prisma.md` §7) and a build-phase guard (`cache-components.md` Pattern 1).
- Dynamic-param pages validate slugs BEFORE the cache scope opens (`cache-components.md` Pattern 6).

## Layer 2 · KV/Redis adapter cache (external API dedup)

`services/{vendor}` adapters dedup external API calls:

```ts
export const vendorSearch = kvCache(
  "vendor:search",
  { ttl: 86400 }, // 24h — always explicit
  async (params: SearchParams) => rawCall(params),
);
```

**Rules:** TTL always explicit. Key format `{vendor}:{operation}:{stable-hash-of-params}`. Track cache hits for cost reporting. Invalidation is time-based only — tags don't apply here.

## Layer 3 · Database snapshots

Snapshot/audit tables are themselves caches — cron jobs write them so user requests never trigger live external calls. User request path reads these tables via the "latest snapshot" pattern (`findFirst` ordered by date desc). Only cron writes here; never rebuild snapshots in user routes.

## Revalidation

Next 16 + cacheComponents: `revalidateTag` REQUIRES the cacheLife profile as a second arg — the one-arg form is a build error (INC-13):

```ts
revalidateTag(`item-${slug}`, "days");
revalidateTag(`collection-${id}`, "minutes");
```

**Rules:** revalidate granular tags, not broad ones. Revalidate AFTER the DB write commits. Batch by tag prefix instead of looping revalidates.

## Tag taxonomy · the convention (the tag LIST is product-defined)

This pack owns the convention only; the concrete tag table (tag → owner → revalidation trigger) lives in each product repo's CLAUDE.md or caching rule.

- **Shape:** kebab-case, `{entity}-${id}` — e.g. `item-${slug}`, `collection-${id}`, `user-${id}`.
- **Sub-resources suffix:** `item-${slug}-reviews`, `item-${slug}-audit`.
- **Granular over broad:** per-record tags, never `all-items` — broad tags kill hit rate on revalidate.
- **One owner per tag:** exactly one cron/action revalidates each tag; document owner + trigger in the product table.
- **Global surfaces get named singletons:** `marketing`, `sitemap`.
- **Never cache user-specific data under a global tag** — data leaks across users.

## When to skip caching

- **Auth-gated personalized data:** `noStore()` at the top of the function.
- **Realtime user input:** server actions + optimistic updates, no cache.
- **Webhooks:** always read fresh, never cache the response.
- **Internal admin tools:** caching is overhead, skip.

```ts
import { unstable_noStore as noStore } from "next/cache";

export async function getMyDashboard() {
  noStore();
  const session = await auth();
  // ...
}
```

## Anti-patterns

- ❌ `'use cache'` without `cacheTag` — un-revalidatable
- ❌ Broad tag (`all-items`) where a per-record tag works
- ❌ TTL-only cache where a tag would work — stale-but-not-expired data
- ❌ Caching user-specific data globally
- ❌ `revalidatePath` for user-facing data — use tags
- ❌ One-arg `revalidateTag(tag)` (INC-13)
- ❌ Multiple revalidates in a loop
- ❌ `'use cache'` Prisma query without the build-phase guard (`cache-components.md` Pattern 1)

## Performance checks

- TTFB < 200ms p50 in production
- Cache hit rate > 80% on cacheable reads
- No "rendered without cache" warnings in dev console
