---
description: Scalability patterns. DB connection pooling, batching, queues, indexes, rate limiting, idempotency.
globs: ["app/api/**/*.ts", "modules/**/*.ts", "services/**/*.ts", "prisma/**/*"]
alwaysApply: true
---

# Scalability

Mapsly's data model spans 2.1M businesses. Every query touches indexed rows. Every cron touches batched work. Every external call is rate-limited. Every webhook is idempotent.

## Database

### Indexes — mandatory

Every column used in `WHERE`, `ORDER BY`, or `JOIN` at scale gets an `@@index`:

```prisma
model Business {
  // ...
  @@index([category, city])
  @@index([country, province, city])
  @@index([lat, lng])
  @@index([category, country])
}
```

Composite indexes match query patterns. Order matters — leading column is the equality filter.

### Connection pooling

- **One `PrismaClient` instance** per Node process. Singleton in `lib/prisma.ts`.
- **Neon serverless adapter** with `@prisma/adapter-neon` — handles pooling automatically.
- Use `DATABASE_URL` (pooled) for the app. Use `DIRECT_URL` (direct) only for `prisma migrate`.

### Batching

For "operate on N rows" patterns, batch:

```ts
// ❌ N+1
for (const id of ids) await prisma.business.update({ where: { id }, data });

// ✅ Single statement
await prisma.business.updateMany({ where: { id: { in: ids } }, data });
```

For inserts:

```ts
await prisma.business.createMany({
  data: rows,
  skipDuplicates: true,
});
```

For mixed batch operations:

```ts
await prisma.$transaction([
  prisma.businessSnapshot.createMany({ data: snapshots }),
  prisma.business.updateMany({ where: { id: { in: ids } }, data: { lastRefreshedAt: now } }),
]);
```

### Transactions

Use `$transaction` when multiple writes must succeed or fail together:

- Lead status change + activity log → transaction
- Subscription upgrade + Stripe webhook log → transaction
- Cron run write + revalidateTag → revalidate AFTER the transaction commits

Avoid:
- Long-running transactions (> 5s) — block connections
- Nested transactions (Prisma doesn't support them)
- External API calls inside a transaction — extend the open time unpredictably

## External API rate limits

Every `services/{vendor}` adapter respects the vendor's limit:

| Vendor | Rate limit | Our strategy |
|---|---|---|
| DataForSEO | 2000/min on Standard, 10/sec/IP | Queue + backoff; never exceed 1 req/sec per cron handler |
| Meta Ad Library | 600/hour per token | Batch competitor scans · cache 6h |
| Anthropic | 50 req/min on Sonnet/Haiku | Batch where possible · sequential not parallel |
| Stripe | 100/sec | Should never approach |
| Resend | 10/sec | Queue if sending bulk |

Adapter pattern:

```ts
import pLimit from 'p-limit';

const limit = pLimit(5); // 5 concurrent calls max

await Promise.all(
  items.map((item) => limit(() => vendorCall(item)))
);
```

## Cron orchestration

Each cron handler does ONE thing for ONE batch. Don't process all businesses in one run:

```ts
// /api/cron/weekly/business-profile-refresh/route.ts
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const run = await openCronRun('weekly:business-profile-refresh');

  try {
    // Get THIS WEEK'S batch — split 2.1M across 7 days
    const dayOfWeek = new Date().getDay();
    const batch = await prisma.business.findMany({
      where: {
        isActive: true,
        // Hash businessId to a day of week — even distribution
        lastRefreshedAt: { lt: new Date(Date.now() - 7 * 86400 * 1000) },
      },
      take: 200, // 200 per run, runs hourly = 4800/day = 33k/wk
      orderBy: { lastRefreshedAt: 'asc' },
    });

    for (const business of batch) {
      await refreshBusiness(business.id, { runId: run.id });
    }

    await closeCronRun(run.id, 'OK', batch.length);
  } catch (e) {
    await closeCronRun(run.id, 'FAILED', 0, String(e));
    throw e;
  }
}
```

**Rules:**
- Bounded per-run work (~5 min Vercel timeout for cron, but stay under 4 min)
- Resume-from-cursor pattern — if a run fails, the next picks up where it left off
- Never lock entire tables — use row-level processing

## Rate limiting (user-facing)

Every `/api/*` route under user auth gets rate-limited:

```ts
// lib/middleware/rate-limit.ts
import { Ratelimit } from '@upstash/ratelimit';
import { kv } from '@vercel/kv';

export const userLimit = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(30, '1 m'), // 30 req/min
  prefix: 'rl:user',
});

export const ipLimit = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(60, '1 m'), // 60 req/min per IP for public routes
  prefix: 'rl:ip',
});
```

```ts
// In a route handler
const session = await auth();
const limit = await userLimit.limit(session.user.id);
if (!limit.success) {
  return Response.json({ error: 'rate_limited', retryAfter: limit.reset }, { status: 429 });
}
```

**Defaults:**
- Public marketing routes: 60/min/IP
- User-auth API: 30/min/user
- Cron handlers: not rate-limited (server-to-server)
- Webhook handlers: 200/min (Stripe sends bursts)

## Idempotency

For any write triggered by an external event (webhooks, retries):

```ts
const existing = await prisma.stripeWebhookEvent.findUnique({
  where: { eventId: stripeEvent.id },
});
if (existing) return Response.json({ ok: true }); // already processed

await prisma.$transaction([
  prisma.stripeWebhookEvent.create({ data: { eventId: stripeEvent.id, type: stripeEvent.type } }),
  // ... actual processing
]);
```

**Rules:**
- Every webhook has an `eventId` table — first action is "have I seen this before?"
- Server actions triggered by user click should also have idempotency keys if the user might double-click — use a UUID in the form.
- Don't rely on database constraints to dedupe — they error, requiring extra handling. Explicit check first.

## Queueing — when needed

For Phase 2+ when scale demands it:
- Use **Inngest** for background job orchestration with retries.
- Or **Vercel Queue** (when GA).
- For Phase 1, cron + DB polling is enough.

Don't pre-build queue infra before it's needed. Add it when:
- Cron handler hits the 4-min timeout
- Need for retry-with-backoff beyond what the cron can do
- Need for fan-out (1 trigger → N workers)

## Anti-patterns

- ❌ Unbounded `findMany` — always pass `take`
- ❌ `findMany` followed by sequential operations in a loop
- ❌ External API call inside a Prisma transaction
- ❌ Long-held transactions (> 5s)
- ❌ Locking entire tables (`UPDATE ... NO WHERE`)
- ❌ Synchronous external calls in a webhook handler — push to background
- ❌ No rate limit on a user-facing route
- ❌ Cron handler that does ALL businesses in one invocation
- ❌ Reaching for queue infrastructure before measuring need
