---
description: Realtime updates (SSE) + optimistic UI patterns. When and how to use each.
globs: ["app/**/*.tsx", "modules/**/*.tsx"]
---

# Realtime + optimistic updates

Two distinct concerns. **Optimistic** = "show the change before the server confirms." **Realtime** = "push from server when something changes."

## Optimistic updates · `useOptimistic`

Use when:
- A user action mutates a row visible on screen (e.g. "Mark contacted" on a lead)
- The mutation is likely to succeed
- Reverting on failure is acceptable

```tsx
'use client'
import { useOptimistic, useTransition } from 'react';
import { setLeadStatus } from '@/modules/lists/actions';

export function LeadStatusPill({ lead }: { lead: Lead }) {
  const [optimisticLead, addOptimistic] = useOptimistic(
    lead,
    (state, newStatus: LeadStatus) => ({ ...state, status: newStatus })
  );
  const [isPending, startTransition] = useTransition();

  return (
    <button
      onClick={() => {
        startTransition(async () => {
          addOptimistic('CONTACTED');
          await setLeadStatus({ leadId: lead.id, status: 'CONTACTED' });
        });
      }}
      disabled={isPending}
    >
      {optimisticLead.status}
    </button>
  );
}
```

**Rules:**
- Wrap the optimistic mutation in `startTransition`.
- Pair with a server action that returns void or the new state.
- On failure: the optimistic value reverts automatically (React re-runs from the source).
- Always show some indicator while `isPending` (subtle opacity, no full spinner).

## Toast feedback

After every successful mutation, push a toast — but only the **first time** the user sees that outcome in a session. Don't toast every single status change in a bulk action.

```ts
// modules/ui/toast.ts (client-side toast queue)
toast.success('Marked 12 leads as contacted', { duration: 3000 });
```

## Realtime · SSE

Use when:
- An event originates on the server (cron job finished, new match added)
- Multiple users may need to know about it
- No user action triggered the event

```tsx
'use client'
import { useEffect, useState } from 'react';

export function NewMatchToaster() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const es = new EventSource('/api/realtime/list-events');
    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === 'new-match') setCount((c) => c + 1);
    };
    return () => es.close();
  }, []);

  if (count === 0) return null;
  return <Toast>{count} new prospects matched · refresh</Toast>;
}
```

**Rules:**
- Use SSE not WebSocket — works on Vercel Edge, simpler reconnect.
- Always provide a fallback (page already shows correct data via the cache).
- Don't fire UI updates more than 1/sec — batch in the client.
- On reconnect (network blip), just resubscribe. Don't try to backfill missed events — the cached page already has them via the next cache refresh.

## Server-side pub/sub

The realtime endpoint subscribes to a channel. The cron job publishes to it.

```ts
// lib/realtime/pubsub.ts
import { kv } from '@vercel/kv';

export async function publish(channel: string, event: Event) {
  await kv.publish(channel, JSON.stringify(event));
}

export function subscribe(channel: string, onMessage: (e: Event) => void) {
  // Use ioredis with KV REST as fallback
  // ...
  return { unsubscribe() { /* ... */ } };
}
```

**Channels:**
- `agency:${agencyId}:list-events` — new matches, removals, refresh complete
- `user:${userId}:business-events` — new review, new alert, score change
- `system:cron` — cron run started/finished (admin dashboard only)

## When to skip both

- **Don't optimistic** if the mutation has > 5% failure rate (use a loading state instead).
- **Don't realtime** if data changes < every 30s (tag-based revalidation is enough).
- **Don't both** for the same event — pick one, otherwise UI fights itself.

## Conflict resolution

If an optimistic update lands and then a realtime event contradicts it:
- Trust the realtime event (it came from the server)
- Revert the optimistic
- Show a subtle toast: "Status updated"

## Anti-patterns

- ❌ Optimistic on a network-flaky mutation
- ❌ `setInterval` polling instead of SSE
- ❌ SSE without auth check at the start
- ❌ Holding subscriptions across page transitions (cleanup in useEffect return)
- ❌ Updating realtime state without batching → UI thrash
- ❌ WebSocket for a one-way push (SSE is simpler)
