---
description: Zod everywhere · structured errors · error boundaries · retry policies
globs: ["app/**/*.ts", "app/**/*.tsx", "modules/**/*.ts", "services/**/*.ts"]
alwaysApply: true
---

# Validation + error handling

Every external input is hostile. Every external call can fail. Plan for both.

## Zod validation — mandatory boundaries

Validate at every boundary:

| Boundary | Where | What |
|---|---|---|
| API request body | route handler | Full body shape |
| URL search params | route handler / page | Full params shape |
| Form data | server action | Full form shape |
| Webhook payload | webhook handler | After signature verify |
| External API response | service adapter | Full response shape |
| Env vars | `lib/env.ts` (boot-time) | All required vars |

```ts
// lib/env.ts — validated at boot
import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
  // ...
});

export const env = Env.parse(process.env);
```

If env validation fails, the app refuses to boot. Better than runtime surprise.

## Schema co-location

Schemas live next to the thing that uses them:

```
modules/lists/
  schemas.ts             # all list-related Zod schemas
  actions.ts             # server actions that import from schemas
  queries.ts
```

Or for routes:
```
app/api/lists/
  schema.ts
  route.ts
```

Never define a one-off schema inside a handler. Always at module level.

## Error response shape

Every API error response is `{ error: string, details?: object }`:

```ts
const parsed = Schema.safeParse(body);
if (!parsed.success) {
  return Response.json(
    { error: 'invalid_input', details: parsed.error.flatten().fieldErrors },
    { status: 400 }
  );
}
```

Standard error codes:
- `invalid_input` (400)
- `unauthorized` (401)
- `forbidden` (403)
- `not_found` (404)
- `conflict` (409)
- `rate_limited` (429)
- `internal_error` (500)
- `service_unavailable` (503)

Never leak internal error messages to clients. Log full error to Sentry, return generic message.

## Try-catch discipline

In server components:
- For expected failures (not-found, forbidden), use Next 16's `notFound()`/`forbidden()`.
- For unexpected failures, let them throw — the closest `error.tsx` catches.

In server actions:
- Try-catch only when you need to translate the error for the client.
- Otherwise let it throw — server-action wrapper logs to Sentry.

In service adapters:
- Try-catch ALL external calls.
- Map vendor errors to our error types: `class ExternalApiError extends Error { vendor: string; code: string; }`
- Add retry policy at the adapter layer (max 2 retries, exp backoff).

## Error boundaries

```tsx
// app/(smb)/dashboard/error.tsx
'use client'
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-8">
      <h2>Something went wrong on the dashboard</h2>
      <p className="text-sm text-gray-500">{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

**Rules:**
- Every route segment with significant work has an `error.tsx`
- Errors auto-bubble to the nearest one
- Always provide a "Try again" via `reset()`
- Send the error to Sentry from `useEffect(() => Sentry.captureException(error), [error])`

## Loading + empty states

Every async UI shows three states explicitly:

```tsx
<Suspense fallback={<LeadsSkeleton />}>
  <Leads />
</Suspense>

async function Leads() {
  const leads = await getLeads(listId);
  if (leads.length === 0) return <EmptyState message="No qualified leads yet" />;
  return <LeadsList items={leads} />;
}
```

Empty states must explain WHY there's nothing and WHAT to do next. Not just "No items".

## Retry policy

For external API calls:

```ts
import pRetry from 'p-retry';

const result = await pRetry(
  async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  {
    retries: 2,
    factor: 2,
    minTimeout: 500,
    maxTimeout: 4000,
    onFailedAttempt: (err) => {
      // log to Sentry breadcrumb
    },
  }
);
```

**Rules:**
- Max 2 retries (3 total attempts).
- Exponential backoff with jitter.
- Don't retry on 4xx (except 408, 429).
- Always set a timeout — never let fetch hang.

## Validation in client components

If the data flows from server → client (typed props), trust the types. Don't re-validate.

If the data comes from user input (forms, search params), validate at the boundary before sending to the server:

```tsx
const form = useForm({ resolver: zodResolver(Schema) });
```

Use `react-hook-form` + `@hookform/resolvers/zod` for forms.

## Anti-patterns

- ❌ `body.someProp` without Zod first — runtime crash later
- ❌ Generic `Error` thrown in a service adapter — caller can't recover
- ❌ Returning vendor's raw error message to the client
- ❌ Try-catch swallowing the error without logging
- ❌ No timeout on `fetch`
- ❌ Retrying a 4xx
- ❌ Empty state that says "No items"
- ❌ Error boundary without `reset` button
