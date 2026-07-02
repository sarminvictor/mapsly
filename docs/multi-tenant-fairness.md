# Multi-tenant fairness — the queue guarantee (WP7-8)

> **Policy doc.** The enrichment dispatch loop is shared across every agency. A
> single 500-lead run must never freeze other tenants for hours. WP3-10 shipped
> the mechanics; this doc states them as a **guarantee** so it's a promise, not
> an implementation accident. **Viktor: confirm the per-agency caps.**

## The guarantee

**No single tenant can monopolize the shared enrichment queue.** Concretely:

1. Every dispatch tick claims work **round-robin across all agencies with
   pending jobs** — one big run cannot starve a small one.
2. A per-agency cap bounds how many of one tenant's runs **fan out
   concurrently**, so one agency can't occupy every worker slot at once.
3. The tick is **time-budgeted** so a heavy discovery drain can't blow the 300s
   Vercel cap or crowd out the job batch.

These hold regardless of run size. A 5-lead run submitted right after a 5,000-
lead run still makes visible progress on the very next tick.

## The three mechanisms (all in `modules/enrichment/dispatch.ts`)

### 1 · Round-robin job claim across agencies — `selectJobBatch`

The QUEUED-job pool is bucketed by owning agency (join
`EnrichmentJob → EnrichmentRun.agencyId`). The batch is then filled by sweeping
the buckets **round-robin**, taking at most `PER_AGENCY_JOBS_PER_TICK` from each
agency per sweep, until `JOB_BATCH` is full:

```
for each round-robin sweep:
  for each agency bucket:
    if batch full → stop
    if this agency already contributed PER_AGENCY_JOBS_PER_TICK → skip
    else claim its next job
```

- **`PER_AGENCY_JOBS_PER_TICK`** = `ENRICHMENT_PER_AGENCY_JOBS` env, else
  `ceil(JOB_BATCH / 2)`. So even two tenants each get a bounded share every tick;
  N tenants interleave fairly.
- **Single-tenant saturation is preserved.** If the per-agency cap leaves the
  batch short and jobs remain (only one tenant has work), a deterministic
  backfill tops the batch up from the remainder — fairness never wastes capacity
  when there's no contention.
- **Orphan/legacy jobs** (no `runId`) go in a single `__none__` bucket so they
  still drain without skewing the per-agency accounting.

### 2 · Per-agency concurrent-run cap — fan-out gate

Before fanning a PENDING run out (PENDING → RUNNING), the loop counts the
tenant's already-RUNNING runs (`loadAgencyRunCaps` → `groupBy agencyId` on
RUNNING) and holds the run back if it's at the cap:

- **`Agency.maxConcurrentRuns`** per agency (schema field, WP0-6), defaulting to
  `DEFAULT_MAX_CONCURRENT_RUNS = 3`.
- One tenant can therefore have at most 3 runs actively fanning out; further runs
  wait their turn. This bounds a single agency's share of the worker pool without
  blocking anyone else's runs.

### 3 · Tick time-budget — discovery can't starve the batch

The heaviest tick work is discovery (a full DataForSEO market pull), so it's
double-bounded and always yields to the job batch:

- **`MAX_DISCOVERIES_PER_TICK = 2`** — at most two markets mapped per tick.
- **`DISCOVERY_DRAIN_BUDGET_MS = 120_000`** — stop draining discoveries after
  ~2 min of wall-clock regardless of count.
- **`TICK_HARD_BUDGET_MS = 240_000`** — ~60s headroom under the 300s cap, so the
  tick always returns cleanly.

The result: **a job batch always runs each tick**, even while big discoveries are
in flight.

## Interaction with the self-chain (WP3-1)

When a tick makes progress and work remains, it re-kicks the dispatch
immediately (self-chain) instead of waiting for the next 2-min cron tick. Because
each tick re-runs the round-robin claim from scratch, the fairness property holds
**across the whole chain** — a newly-submitted small run is picked up on the next
link, not after the big run fully drains.

## Interaction with churn (WP7-12)

A canceled/past-due agency's new runs are stopped by the spend-member + balance
gates; the fairness rails naturally stop scheduling new work for it (no pending
runs → no buckets), while its already-held in-flight batch completes. No special
case needed.

## Tuning knobs

| Knob                         | Default               | Effect                                           |
| ---------------------------- | --------------------- | ------------------------------------------------ |
| `ENRICHMENT_PER_AGENCY_JOBS` | `ceil(JOB_BATCH / 2)` | Max jobs one agency claims per round-robin sweep |
| `Agency.maxConcurrentRuns`   | `3`                   | Max concurrently-fanning-out runs per agency     |
| `MAX_DISCOVERIES_PER_TICK`   | `2`                   | Market maps per tick                             |
| `DISCOVERY_DRAIN_BUDGET_MS`  | `120_000`             | Wall-clock cap on discovery draining             |

Lower `ENRICHMENT_PER_AGENCY_JOBS` for stricter fairness under many tenants;
raise `maxConcurrentRuns` on a specific agency for a paid-priority tier.

## The tenant-facing answer

> "The enrichment queue is shared, but no one can hog it. Work is claimed
> round-robin across agencies every couple of minutes, one agency can only fan a
> bounded number of runs out at once, and the tick is time-boxed so heavy market
> mapping never blocks live enrichment. A small run submitted behind a huge one
> still starts on the next cycle."

## Anti-patterns

- ❌ FIFO-only job claim (one 5,000-lead run drains before anyone else moves).
- ❌ Unbounded concurrent fan-out per agency (one tenant eats every worker slot).
- ❌ Unbounded discovery drain (blows the 300s cap, starves the job batch).
- ❌ Wasting capacity when there's no contention (the single-tenant backfill exists).

## Cites

- WP3-10 (round-robin claim + per-agency concurrent-run cap) — `dispatch.ts`
  `selectJobBatch`, `loadAgencyRunCaps`.
- WP3-7 (tick budget) — `MAX_DISCOVERIES_PER_TICK`, `DISCOVERY_DRAIN_BUDGET_MS`.
- WP3-1 (self-chain) — `.claude/rules/realtime-runs-adr.md`.
- WP0-6 (`Agency.maxConcurrentRuns`, `Agency.maxSeats`).
