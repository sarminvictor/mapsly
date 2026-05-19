---
description: Performance is the #1 non-negotiable requirement. Every page must hit Core Web Vitals "Good" thresholds. Auto-loaded for everything.
globs: ["**/*.ts", "**/*.tsx"]
alwaysApply: true
---

# Performance · the #1 requirement

Mapsly's product promise is speed. A slow page is a broken page. **Every route must achieve Lighthouse mobile Performance ≥ 90, LCP ≤ 2.0s, CLS ≤ 0.05, INP ≤ 150ms in production**, validated by `performance-auditor` agent before merge.

## Architecture defaults

1. **Server components by default.** No `'use client'` unless the component (a) has event handlers, (b) uses browser APIs, (c) uses state hooks. When you add `'use client'`, document why in a header comment.

2. **Partial Pre-rendering (PPR).** `experimental.cacheComponents: true` is on. Static chrome ships as HTML; dynamic content streams. Every page must declare its caching intent — either `'use cache'` at the top or `noStore()` if truly dynamic.

3. **Stream over block.** Wrap dynamic sections in `<Suspense>` with a sensible fallback. Never block first paint on a slow query.

4. **Edge runtime** for: middleware, marketing pages, public share links, simple `/api/*` reads. **Node runtime** for: anything touching Prisma, anything that calls external APIs.

5. **No live API in user request path.** All product data reads from `BusinessSnapshot`, `Review`, `LighthouseAudit`, etc. — pre-populated by cron. Enforced by `lib/middleware/no-live-api.ts`.

## React patterns

### `use cache` directive

For any pure server function whose output is determined by inputs:

```tsx
"use cache";
import { cacheLife, cacheTag } from "next/cache";

async function getBusinessSnapshot(businessId: string) {
  cacheLife("hours"); // or 'days' / 'weeks' / 'max'
  cacheTag(`business-${businessId}`);

  return prisma.businessSnapshot.findFirst({
    where: { businessId },
    orderBy: { snapshotDate: "desc" },
  });
}
```

- **`cacheLife` profiles** (set in `next.config.ts`): `seconds`, `minutes`, `hours`, `days`, `weeks`, `max`. Pick the most generous one consistent with data freshness.
- **`cacheTag`** every cacheable read. Revalidate by tag, never by path.
- **`revalidateTag('business-${id}', 'days')`** when the underlying data changes (cron job, user action).

### Cache tag conventions

| Resource               | Tag                        |
| ---------------------- | -------------------------- |
| Per-business snapshot  | `business-${slug}`         |
| Per-business reviews   | `business-${slug}-reviews` |
| Per-list leads         | `list-${id}`               |
| Per-list-detail full   | `list-${id}-full`          |
| Per-keyword SERP       | `kw-${keywordId}`          |
| Per-agency aggregate   | `agency-${id}`             |
| Global marketing       | `marketing`                |
| SEO sitemap            | `sitemap`                  |
| User session aggregate | `user-${id}`               |

Never use untagged caches. Untagged = unrevalidatable = stale forever.

### Suspense pattern

```tsx
export default async function DashboardPage() {
  return (
    <div>
      <PageHeader /> {/* renders instantly */}
      <Suspense fallback={<KpiSkeletons />}>
        <KpiTiles /> {/* streams when ready */}
      </Suspense>
      <Suspense fallback={<AlertsSkeleton />}>
        <AlertsFeed />
      </Suspense>
    </div>
  );
}
```

Stream every above-the-fold block independently. Skeletons must match final dimensions exactly — no CLS.

### Client components

- Mark with `'use client'` at top
- Keep them at the leaves of the tree, never high up
- Pass server-fetched data as props
- Use `useTransition` for any state change that triggers a server action
- Use `useOptimistic` when the UI should reflect the change before the server confirms (see `optimistic-updates.md`)

## Frontend assets

1. **Fonts.** Use `next/font/google` with `display: 'swap'`. Preconnect to `fonts.googleapis.com` and `fonts.gstatic.com`. Subset to Latin + Latin-Extended only.
2. **Images.** Always `next/image` with explicit `width`/`height`. Lazy-load below-the-fold. Above-the-fold images get `priority`. WebP/AVIF auto by Next.
3. **Bundle budget.** Per route: ≤ 200kB First Load JS (gzipped). Auditor enforces.
4. **Code splitting.** Heavy chart libs (recharts, etc.) → `next/dynamic` with `ssr: false`. Only loads when rendered.
5. **Third-party scripts.** Wrap with `next/script` strategy `afterInteractive` or `lazyOnload`. Never `beforeInteractive` without exec justification.
6. **CSS.** Tailwind 4 with `inlineCss: true` (replaces critters). No global stylesheets beyond `globals.css`.

## Server-side performance

1. **Prisma queries.**
   - Always use `select` to pick only the fields you'll render. Never default `findMany`/`findFirst`.
   - Use `include` for relations only when needed.
   - Add `@@index` for every column used in WHERE, ORDER BY, or JOIN at scale.
   - For aggregations, prefer raw SQL (`prisma.$queryRaw`) over Prisma's `groupBy` for large datasets.

2. **N+1 prevention.**
   - Use `include` to fetch relations in one query.
   - For "fetch business → fetch latest snapshot for each" patterns, use `findMany` with `include: { snapshots: { take: 1, orderBy: { snapshotDate: 'desc' } } }`.
   - Never loop a fetch.

3. **Connection pooling.** Neon adapter handles this — but **never** create a new `PrismaClient` outside `lib/prisma.ts`. The singleton pattern is mandatory.

4. **`after()` for non-critical work.** Resend emails, analytics writes, cron telemetry — wrap with `import { after } from 'next/server'` so they don't block the response.

## Performance budgets (enforced by performance-auditor)

| Metric                        | Budget      | Fail threshold     |
| ----------------------------- | ----------- | ------------------ |
| Lighthouse Mobile Performance | ≥ 90        | < 80 blocks merge  |
| LCP                           | ≤ 2.0s      | > 2.5s blocks      |
| CLS                           | ≤ 0.05      | > 0.1 blocks       |
| INP                           | ≤ 150ms     | > 200ms blocks     |
| First Load JS (gz)            | ≤ 200kB     | > 300kB blocks     |
| Server response (TTFB)        | ≤ 200ms p50 | > 600ms p95 alerts |
| API route p95                 | ≤ 500ms     | > 1.5s blocks      |

`performance-auditor` runs against every PR's preview deploy.

## Common anti-patterns (don't)

- ❌ `'use client'` at the page level
- ❌ `useEffect` to fetch data (use server component or server action)
- ❌ Untagged `unstable_cache`
- ❌ Inline `<style>` tags for anything dynamic
- ❌ `setInterval` for polling (use SSE or server actions with revalidate)
- ❌ Rendering 1,000 rows without virtualization
- ❌ Awaiting Prisma inside a `.map` (N+1)
- ❌ Sync `JSON.parse` of large blobs on the server (use streaming JSON)
- ❌ Big images uploaded unoptimized (we hand them to Vercel Blob + transform)

## How to measure

1. Local: `pnpm build && pnpm start && lighthouse http://localhost:3000/...`
2. Preview: every PR auto-runs `performance-auditor` against Vercel preview URL
3. Production: real-user-monitoring via Vercel Speed Insights (free with Vercel Pro)

Performance regression = revert. No exceptions.
