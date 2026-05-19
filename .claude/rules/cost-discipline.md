---
description: How Mapsly stays profitable. Read before adding any external API call.
globs: ["app/api/**/*.ts", "services/**/*.ts", "modules/**/*.ts"]
alwaysApply: true
---

# Cost discipline

The business only works if API costs stay under the per-tier ceiling. Every external API call is a cost. Every retry is a cost. Every uncached re-read is a cost.

## Hard rules

1. **No external API call in user request path.** Period. If a page needs Lighthouse data, it reads from `LighthouseAudit` (latest row). The audit was written by the weekly cron.

2. **Every call goes through a `services/{vendor}` adapter.** Adapters wrap the raw HTTP call with:
   - Cost increment on the open `CronRun`
   - Retry budget (max 2 retries, exponential backoff, never more)
   - 24h dedup cache on Vercel KV for same-input calls
   - Timeout (10s default, can be raised explicitly)

3. **CronRun is sacred.** Every cron handler opens `CronRun` at start, closes at end (status: OK / PARTIAL / FAILED), and writes `costUsd` total. If you can't track cost, don't call the API.

4. **Tier ceilings are enforced.** A `Business` row has an implicit tier (its owner's `User.role` / `Agency.plan`). Cron jobs read this and skip the business if the daily/weekly/monthly ceiling is reached. See `lib/cost/tier-ceiling.ts`.

5. **Batch where possible.** DataForSEO Keyword Volume supports up to 1,000 keywords per batch. Use it. Same for SERP scans.

6. **DataForSEO Standard queue, not Live.** Standard is 10× cheaper. Live is reserved for:
   - Daily brand-hijack scan (latency-critical)
   - User-triggered "Re-audit now" (rare, billed accordingly)

7. **Vercel Blob storage:** every blob has a TTL (90d for reports, 30d for shareable links). Audit blob list monthly — orphans get deleted.

## When you're tempted to break a rule

- "It's just one call" → no. Multiply by 2.1M businesses.
- "It'll be cached" → only if you write the cache key correctly. Show me the test.
- "The user explicitly asked" → that's the on-demand path. Bill it to the user's CronRun anyway. Track it.
- "It's for an admin view" → fine, but mark `runOnce: true` and add to monthly review.

## Adapter pattern (template)

```ts
// services/dataforseo/maps-search.ts
import { z } from "zod";
import { withCostCounter } from "./cost-counter";
import { cache24h } from "@/lib/cache";

const MapsSearchResponse = z.object({
  /* ... */
});

export const mapsSearch = withCostCounter(
  "dataforseo.maps.search",
  0.0006, // unit cost
  cache24h("dataforseo:maps:search", async (params: MapsSearchParams) => {
    const response = await fetch(/* ... */);
    return MapsSearchResponse.parse(await response.json());
  }),
);
```

`withCostCounter` reads the current `CronRun` from AsyncLocalStorage and increments `costUsd`. If there's no open `CronRun`, it throws — that's the "no live API in user path" enforcement.

## Cost monitoring

- `/api/admin/cost-report` returns last-7d cost per job per business
- `/cost-audit` skill prints a budget vs actual summary
- Sentry alerts if any single `CronRun.costUsd > 5×` its expected value (likely a runaway loop)
