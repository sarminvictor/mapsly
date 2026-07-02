# Data fetching · pick the right pattern

Five ways to fetch data. Use the most aggressive one consistent with freshness needs.

## Decision tree

```
Is the data the same for every user, every visit?
├── YES → Static + 'use cache' with cacheLife('days' | 'weeks' | 'max')
│         (marketing, share links, reference data)
│
└── NO, depends on user/session
    │
    ├── Can data be stale by minutes/hours? (dashboards, lists)
    │   → Server component + 'use cache' + cacheTag + revalidate via tag
    │
    ├── Must be fresh on every request? (admin, billing state)
    │   → Server component + noStore()
    │
    ├── Mutation (form submit, status change)?
    │   → Server action + revalidateTag
    │
    └── Realtime / event-driven?
        → SSE for short-lived surfaces · poll + Redis counters for long jobs (see Pattern 5)
```

## Pattern 1 · Static + `use cache`

```tsx
"use cache";
import { cacheLife, cacheTag } from "next/cache";

export default async function MarketingHome() {
  cacheLife("weeks");
  cacheTag("marketing");
  return <Hero />;
}
```

Built at deploy time, served as HTML. Dynamic-param static pages (SEO/city/detail routes): validate slugs BEFORE the cache scope — `cache-components.md` Pattern 6.

## Pattern 2 · Server component + tag-revalidated cache (the app default)

```tsx
export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) unauthorized();

  return (
    <div>
      <Suspense fallback={<KpiSkeletons />}>
        <KpiTiles userId={session.user.id} />
      </Suspense>
      <Suspense fallback={<FeedSkeleton />}>
        <ActivityFeed userId={session.user.id} />
      </Suspense>
    </div>
  );
}
```

```ts
// queries.ts
"use cache";
import { cacheLife, cacheTag } from "next/cache";
import prisma, { serialize } from "@/lib/prisma";

export async function getSnapshot(userId: string) {
  cacheLife("hours");
  cacheTag(`user-${userId}-snapshot`);
  return serialize(
    await prisma.record.findFirst({
      where: { ownerUserId: userId },
      select: { id: true, name: true /* only rendered fields */ },
    }),
  );
}
```

Stream every above-the-fold block independently; skeletons match final dimensions (no CLS). Auth-gated pages need the Suspense wrap — `cache-components.md` Pattern 2.

## Pattern 3 · `noStore()` for must-be-fresh

```ts
import { unstable_noStore as noStore } from "next/cache";

export async function getBillingStatus(userId: string) {
  noStore();
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      /* ... */
    },
  });
}
```

ONLY when even 10-second staleness is wrong (billing, auth state, admin actions). Otherwise prefer cached.

## Pattern 4 · Server actions for mutations

```ts
"use server";
import { z } from "zod";
import { revalidateTag } from "next/cache";

const Schema = z.object({
  itemId: z.string().cuid(),
  status: z.enum(["NEW", "ACTIVE", "DONE", "HIDDEN"]),
});

export async function setItemStatus(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");

  const parsed = Schema.parse(Object.fromEntries(formData));
  await prisma.item.update({
    where: { id: parsed.itemId },
    data: { status: parsed.status },
  });

  revalidateTag(`item-${parsed.itemId}`, "minutes"); // two-arg form — caching.md
  revalidateTag(`collection-${collectionId}`, "minutes");
}
```

**Rules:** Zod-validate input. Auth check at the top. Ownership check before the write. Revalidate granular tags after the write. Pair with `useOptimistic` for optimistic UX.

## Pattern 5 · Realtime — SSE vs poll, by job duration

**Short-lived, sub-minute surfaces** (new-item toast, live counter): SSE is fine.

```ts
// app/api/realtime/events/route.ts — auth check first, AbortSignal cleanup,
// heartbeat every 30s, client batches UI updates to ≤1/sec.
```

**Serverless caveat — long-running jobs (minutes to hours):** an SSE route holds a Vercel function open for the entire watch session — billed wall-clock and killed at `maxDuration` (`vercel.md` §7), forcing reconnect machinery. And REST-based Redis (Upstash) can't `SUBSCRIBE` without a persistent socket. For job/run progress, use **short-interval polling backed by Redis counters with ETag/304**:

- Worker `INCR`s `run:{id}:done` / `run:{id}:failed` on each terminal transition (TTL'd); `total` set at fan-out.
- `GET /api/runs/[id]/progress` (auth → Redis only, no DB) returns `{done,total,failed,status}` with an `ETag`; unchanged polls are `304`.
- Client polls at 1–2s; the DB stays source of truth and periodically corrects the counters.

Identical UX to SSE for a progress bar, ~$0 incremental cost. If a genuinely sub-second collaborative surface ever ships, terminate the socket on a host WITHOUT a duration cap — never on a serverless function.

## Pagination

**Cursor-based (default for any list > 50 items):** `take: n + 1` with `cursor`/`skip: 1`, pop the last row as the next cursor. Stable under inserts, fast on indexed columns, required for infinite scroll.

**Offset-based:** only for small admin tables (< 1,000 rows) with page-numbered UI.

**Virtualization:** lists rendering > 100 rows at once use a virtual scroller (`@tanstack/react-virtual`). Don't render off-screen rows.

## Anti-patterns

- ❌ `useEffect(() => { fetch... }, [])` — use a server component
- ❌ Re-fetching after a mutation when `revalidateTag` would work
- ❌ Offset pagination on large tables — cursor only
- ❌ `findMany` without `select` (see `prisma.md` §9c)
- ❌ Polling with client `setInterval` against an uncached endpoint — use SSE or the ETag/304 poll pattern
- ❌ SSE for a minutes-long job on a serverless function
- ❌ One Prisma call per row (N+1) — `include`/batch upfront
