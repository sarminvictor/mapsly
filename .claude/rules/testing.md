---
description: Test only what matters. Don't overlap. Don't test what types already enforce. Integration > unit.
globs: ["**/*.test.ts", "**/*.test.tsx"]
alwaysApply: true
---

# Testing · the discipline

We test **core paths**, not surface details. Tests exist to prove invariants — not to inflate coverage. A test you wouldn't lose sleep deleting is a test that should be deleted.

## The decision tree

```
Is this code...
│
├── Pure UI styling / layout?
│   → DON'T TEST. Visual regression isn't worth the maintenance.
│
├── Just rendering server data into JSX?
│   → DON'T TEST. TypeScript catches the contract.
│
├── A type that's enforced at compile time?
│   → DON'T TEST. Types already cover it.
│
├── A core business invariant?
│   → MUST TEST. Integration if it crosses a boundary, unit if pure.
│
├── A cron job's correctness?
│   → MUST TEST. Integration against a real test DB.
│
├── A signal scoring formula?
│   → MUST TEST. Unit, dozens of cases.
│
├── A webhook handler?
│   → MUST TEST. Integration with signature verify + idempotency.
│
├── An auth gate?
│   → MUST TEST. Integration, both pass + fail paths.
│
├── A payments path?
│   → MUST TEST. Integration with all Stripe states.
│
└── Anything else?
    → SKIP unless it's broken twice. Failing twice = test needed.
```

## What we DO test

### 1. Signal scoring + computed metrics
**Why:** Wrong score = wrong UX everywhere. Easy to regress.

```ts
// modules/scoring/__tests__/mapsly-score.test.ts
import { computeMapslyScore } from '../mapsly-score';

describe('computeMapslyScore', () => {
  test('weights reputation 25%', () => {
    const score = computeMapslyScore({
      rating: 5.0, reviewCount: 1000,
      replyRate: 0, /* ... rest at 0 */
    });
    // Reputation alone = 2.5 of 10
    expect(score).toBeCloseTo(2.5, 1);
  });

  test('clamps to 0–10', () => {
    expect(computeMapslyScore({ /* all perfect */ })).toBeLessThanOrEqual(10);
    expect(computeMapslyScore({ /* all zero */ })).toBeGreaterThanOrEqual(0);
  });
});
```

### 2. Cron job correctness
**Why:** Cron jobs run unattended. Silent failure is the worst kind.

```ts
// app/api/cron/weekly/snapshot-write/__tests__/handler.test.ts
import { setupTestDb, seedBusiness } from '@/tests/helpers';
import { GET } from '../route';

beforeEach(setupTestDb);

test('writes snapshot row for active businesses only', async () => {
  await seedBusiness({ isActive: true });
  await seedBusiness({ isActive: false });

  const res = await GET(new Request('http://localhost', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
  expect(res.status).toBe(200);

  const snapshots = await prisma.businessSnapshot.findMany();
  expect(snapshots).toHaveLength(1);
});

test('logs costUsd to CronRun on success', async () => {
  // ...
});

test('marks CronRun FAILED if a single business throws', async () => {
  // ...
});
```

### 3. Webhook handlers
**Why:** Bad webhook handler = silent billing breaks.

```ts
// app/api/webhooks/stripe/__tests__/handler.test.ts
test('rejects request without valid signature', async () => {
  const res = await POST(new Request('http://localhost', { body: '{}' }));
  expect(res.status).toBe(400);
});

test('handles invoice.paid idempotently', async () => {
  const event = mockStripeEvent('invoice.paid');
  await POST(reqWithEvent(event));
  await POST(reqWithEvent(event)); // replay
  // assert: subscription state updated exactly once
});
```

### 4. Auth gates
**Why:** Forgetting an auth check is a security incident.

```ts
test('GET /api/lists requires session', async () => {
  const res = await fetch('/api/lists');
  expect(res.status).toBe(401);
});

test('GET /api/lists/:id rejects cross-agency access', async () => {
  const { listId, otherUserToken } = await setupTwoAgencies();
  const res = await fetchWithAuth(`/api/lists/${listId}`, otherUserToken);
  expect(res.status).toBe(403);
});
```

### 5. Filter evaluation logic (Hunter)
**Why:** Hunter mis-evaluating a filter = wrong list = lost revenue.

```ts
test('filter "reply rate < 25%" matches businesses with replyRate 0–24', async () => {
  const matches = await evaluateFilter({ reply_rate: { op: '<', value: 25 } });
  expect(matches.every((b) => b.replyRate < 25)).toBe(true);
});
```

### 6. Critical UI flows (E2E, sparingly)
- Sign-in via magic link
- Create a list → see it on dashboard → drill into it
- Mark a lead as contacted → status persists on reload

Use Playwright. 5 E2E tests max for v1.

## What we DON'T test

- ❌ React component rendering (TypeScript covers prop contracts)
- ❌ Style / Tailwind class output
- ❌ Component snapshot tests (brittle, low signal)
- ❌ Single-function utilities that just rename data
- ❌ Mocked unit tests where the mock is the entire test
- ❌ Trivial mappers (`getFullName({first, last}) → "first last"`)
- ❌ Storybook stories (we don't use Storybook)
- ❌ Internal admin routes (use them, find bugs in dogfooding)

## Tooling

- **Vitest** for unit + integration. Fast, Vite-based.
- **Playwright** for E2E. Headless Chromium, runs in CI.
- **Test DB:** a Neon branch per CI run, seeded by `tests/helpers/setupTestDb.ts`.
- **Fixtures:** `prisma/seed-test.ts` for stable test data.
- **No mocking DB.** Integration tests hit real Neon (test branch).
- **Mock external APIs at the adapter boundary** — `services/dataforseo/__mocks__/`. The adapter is the seam.

## Test layout

```
modules/scoring/
  mapsly-score.ts
  __tests__/
    mapsly-score.test.ts        # unit, pure
app/api/cron/weekly/snapshot-write/
  route.ts
  __tests__/
    handler.test.ts             # integration, hits DB
app/api/webhooks/stripe/
  route.ts
  __tests__/
    handler.test.ts             # integration, mock Stripe events
tests/
  e2e/
    sign-in.spec.ts             # Playwright
    create-list.spec.ts
  helpers/
    setupTestDb.ts
    mockStripeEvent.ts
```

## Coverage targets

We do NOT chase coverage %. We chase **invariant coverage**:

| Area | Coverage target |
|---|---|
| Signal scoring | 100% of formulas |
| Cron handlers | 100% have a happy-path + failure-path test |
| Webhook handlers | 100% have signature + idempotency test |
| Auth gates | 100% protected routes have 401/403 test |
| Hunter filter evaluation | 100% of comparator types (`<`, `≤`, `=`, `≥`, `between`, `missing`, `present`) |
| Stripe billing paths | 100% of subscription state transitions |
| Everything else | 0% required |

Don't add tests just to push a number. Add tests because the test prevents an incident.

## CI gates

- `pnpm test:run` must pass for every PR
- Test runtime budget: < 5 min for full suite
- If a test starts failing flakily, **delete it or fix it**. No `.skip()` that lives more than a sprint.

## Anti-patterns

- ❌ Snapshot tests of JSX output
- ❌ Mocking React components for testing a component
- ❌ Tests that test the mock
- ❌ "Coverage must be > 80%" — chasing numbers, not invariants
- ❌ Skipping tests indefinitely (delete or fix)
- ❌ One mega test that covers the entire flow + setup is 200 lines
- ❌ Testing implementation detail (private helper signature) instead of public behavior
