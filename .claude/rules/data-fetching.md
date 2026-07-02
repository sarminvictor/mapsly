---
description: When to use SSR, SSG, ISR, streaming, server actions, client fetch. Pick the right pattern per route.
globs: ["app/**/*.tsx", "modules/**/*.ts", "modules/**/*.tsx"]
alwaysApply: true
---

# Data fetching · pick the right pattern

> **OVERRIDE · 2026-07-02.** Pattern 5 (SSE) is **SUPERSEDED for long-running enrichment runs** by
> `.claude/rules/realtime-runs-adr.md` — poll + Redis counters with ETag/304, not SSE, on this stack.
> SSE remains valid only for genuinely sub-second collaborative surfaces (none shipped today).

There are 5 ways to fetch data in this app. Use the most aggressive one consistent with freshness needs.

## Decision tree

```
Is the data the same for every user, every visit?
├── YES → Static + 'use cache' with cacheLife('days' | 'weeks' | 'max')
│         (marketing pages, signal definitions, /share/[id])
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
    └── Realtime / event-driven? (live counter, new-match toast)
        → SSE endpoint + EventSource in a client component
```

## Pattern 1 · Static + `use cache`

For marketing, share-links, signal definitions.

```tsx
// app/(marketing)/page.tsx
"use cache";
import { cacheLife, cacheTag } from "next/cache";

export default async function MarketingHome() {
  cacheLife("weeks");
  cacheTag("marketing");

  return <Hero />;
}
```

**Result:** Built at deploy time. Served as HTML. Revalidate by editing copy + pushing.

## Pattern 2 · Server component + tag-revalidated cache

The default for app dashboards.

```tsx
// app/(smb)/dashboard/page.tsx
import { Suspense } from "react";
import {
  getBusinessSnapshot,
  getAlerts,
} from "@/modules/smb-dashboard/queries";

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) unauthorized();

  return (
    <div>
      <Suspense fallback={<KpiSkeletons />}>
        <KpiTiles userId={session.user.id} />
      </Suspense>
      <Suspense fallback={<AlertsSkeleton />}>
        <Alerts userId={session.user.id} />
      </Suspense>
    </div>
  );
}

async function KpiTiles({ userId }: { userId: string }) {
  const snapshot = await getBusinessSnapshot(userId);
  return <KpiUI snapshot={snapshot} />;
}
```

```ts
// modules/smb-dashboard/queries.ts
"use cache";
import { cacheLife, cacheTag } from "next/cache";
import prisma from "@/lib/prisma";

export async function getBusinessSnapshot(userId: string) {
  cacheLife("hours");
  cacheTag(`user-${userId}-snapshot`);

  return prisma.business.findFirst({
    where: { ownerUserId: userId },
    select: {
      id: true,
      name: true,
      snapshots: {
        take: 1,
        orderBy: { snapshotDate: "desc" },
        select: { mapslyScore: true, msiRank: true, msiTotal: true },
      },
    },
  });
}
```

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

Use ONLY when the data is so volatile that even 10-second staleness is wrong (billing, auth state, admin actions). Otherwise prefer cached.

## Pattern 4 · Server actions for mutations

```tsx
// modules/lists/actions.ts
"use server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { auth } from "@/lib/auth";

const SetLeadStatusSchema = z.object({
  leadId: z.string().cuid(),
  status: z.enum(["NEW", "CONTACTED", "REPLIED", "WON", "LOST", "HIDDEN"]),
});

export async function setLeadStatus(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");

  const parsed = SetLeadStatusSchema.parse(Object.fromEntries(formData));

  await prisma.lead.update({
    where: { id: parsed.leadId },
    data: { status: parsed.status, statusChangedAt: new Date() },
  });

  revalidateTag(`lead-${parsed.leadId}`, "minutes");
  revalidateTag(`list-${listId}`, "minutes");
}
```

**Rules:**

- Always validate input with Zod.
- Always check auth at the top.
- Always revalidate granular tags after the write.
- For optimistic UX, pair with `useOptimistic` in the client form. See `optimistic-updates.md`.

## Pattern 5 · SSE for realtime

For "new match arrived" toasts and live activity feed.

```ts
// app/api/realtime/list-events/route.ts
import { auth } from "@/lib/auth";

export const runtime = "edge";

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return new Response(null, { status: 401 });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const sub = subscribeToListEvents(session.user.id, (event) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      });
      req.signal.addEventListener("abort", () => sub.unsubscribe());
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

Backend pub/sub: Vercel KV channels or a lightweight Postgres `LISTEN/NOTIFY`. Prefer KV — Neon doesn't always support LISTEN.

**Rules:**

- SSE over WebSocket — simpler, works on Vercel Edge.
- Always pass an `AbortSignal` to clean up subscriptions.
- Heartbeat every 30s with `: keep-alive\n\n` if no real events.

## Pagination patterns

### Cursor-based (default for any list with > 50 items)

```ts
export async function getLeads(listId: string, cursor?: string, take = 25) {
  return prisma.lead.findMany({
    where: { listId },
    orderBy: { matchScore: "desc" },
    take: take + 1,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
    select: {
      /* ... */
    },
  });
  // Client gets back `take + 1` items, pops the last as the next cursor.
}
```

**Why cursor:** Stable as the underlying data shifts (offsets jump when rows insert). Faster on indexed columns. Required for infinite-scroll UIs.

### Offset-based (only for small admin tables or "page N of N" UI)

```ts
prisma.cronRun.findMany({ take: 50, skip: (page - 1) * 50 });
```

Acceptable when total count is small (<1,000) and UI is page-numbered.

### Virtualization

For lists rendering > 100 items at once (Hunter results), use a virtual scroller — `@tanstack/react-virtual`. Don't render off-screen rows.

## Anti-patterns

- ❌ Client-side fetching what could be server-fetched (slower, blocks rendering)
- ❌ `useEffect(() => { fetch... }, [])` — use a server component
- ❌ Re-fetching after a mutation when `revalidateTag` would work
- ❌ Offset pagination on `Business` (2.1M rows) — cursor only
- ❌ `findMany` without `select`
- ❌ Polling with `setInterval` — use SSE
- ❌ One Prisma call per row (N+1) — always `include` upfront
