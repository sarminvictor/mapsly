# ADR · Realtime for enrichment runs = poll + Redis counters, NOT SSE

**Status:** Accepted (2026-07-01) · **Scope:** the agency-portal enrichment rail only · **Supersedes** the generic SSE guidance in `.claude/rules/realtime-and-optimistic.md` _for long-running enrichment runs specifically_.

## Decision

Do **NOT** build Server-Sent Events (or WebSockets) to stream enrichment-run progress or leads-landing to the workbench. Use **short-interval polling backed by Redis counters with ETag/304**:

- On every `EnrichmentJob` terminal transition, `INCR run:{runId}:done` / `run:{runId}:failed` in Redis (ioredis over `REDIS_URL` — already a first-class KV backend, `lib/cache/redis-client.ts`), 24h TTL; set `total` at fan-out.
- `GET /api/agency/runs/[id]/progress` (auth + agency check → Redis-only, no Prisma) returns `{done,total,failed,status}` with an `ETag`; unchanged polls are `304`.
- `EnrichingStep` and the live workbench poll it at 1–2s; the DB remains source of truth (the dispatch tick's `updateRunProgress` seeds/corrects the counters).

## Why NOT SSE on this stack

1. **Runs last minutes-to-hours.** An SSE route holds a Vercel function open for the entire watch session — billed wall-clock — and is cut at `maxDuration` (300s), forcing reconnect machinery you'd have to build anyway.
2. **Upstash-REST Redis cannot `SUBSCRIBE`** without a persistent socket, so the pub/sub half of an SSE design isn't free on the current infra either.
3. **Poll + Redis + 304 is indistinguishable UX** for this workload (a progress bar and rows appearing every 1–2s) at ~$0 incremental cost.

## When SSE _would_ be justified (future, not now)

Only a genuinely sub-second collaborative surface (e.g. multiple teammates claiming leads in the same table in real time). If that ships, **terminate the socket on the DigitalOcean Boxly worker** (it can hold long-lived connections and has no 300s cap), never on a Vercel function.

## Consequence for the autonomous loop

The generic rule file recommends SSE for "event originates on the server" cases. For enrichment runs that recommendation is a trap on this platform. This ADR is the override — do not build SSE for runs; extend the poll+Redis pattern instead.

## Cites

- `docs/agency-portal-architecture-review-2026-07-01.html` §18 (infrastructure-per-dollar)
- `lib/cache/redis-client.ts` (persistent-socket Redis, server-side only)
- `vercel.json` (300s `maxDuration` budgets)
- `.claude/rules/realtime-and-optimistic.md` (the generic guidance this scopes)
