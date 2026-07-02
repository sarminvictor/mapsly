// modules/enrichment/run-progress-counter.ts · Redis run-progress counters (WP3-3).
//
// Per `.claude/rules/realtime-runs-adr.md`: enrichment-run progress is served by
// short-interval polling backed by Redis counters (NOT SSE). On every
// EnrichmentJob TERMINAL transition we bump `run:{runId}:done` /
// `run:{runId}:failed`; the total is written once at fan-out. A cheap
// `GET /api/agency/runs/[id]/progress` reads Redis only (no Prisma) and answers
// with an ETag/304 so the workbench + EnrichingStep poll at ~zero DB cost.
//
// The DB remains the source of truth: `updateRunProgress` (the dispatch tick)
// SEEDS/CORRECTS these counters each tick from the authoritative job rows, so a
// dropped INCR (Redis blip, a job that terminated on a path that didn't bump)
// self-heals within one tick. Per `.claude/rules/incident-prevention.md` the
// cache is an OPTIMIZATION — every call is wrapped and DEGRADES OPEN (a Redis
// outage never blocks dispatch; the endpoint falls back to a Prisma count).

import { getKv } from "@/lib/cache/kv";

// 24h TTL · a run finishes in minutes-to-hours; the counters are display-only
// and self-correct from the DB, so an expiry mid-run just triggers a one-tick
// re-seed. Refreshed on every write so an active run never expires under it.
const TTL_SEC = 86_400;

function doneKey(runId: string): string {
  return `run:${runId}:done`;
}
function failedKey(runId: string): string {
  return `run:${runId}:failed`;
}
function totalKey(runId: string): string {
  return `run:${runId}:total`;
}
function statusKey(runId: string): string {
  return `run:${runId}:status`;
}

export interface RunProgressCounters {
  done: number;
  failed: number;
  total: number;
  status: string | null;
}

/**
 * Feature-detect the incr/expire-capable KV client (only the ioredis backend
 * implements them — @vercel/kv REST is cast to KvClient without them). Returns
 * null when Redis is absent OR the client can't INCR, so every caller degrades.
 */
function counterKv(): {
  incr(key: string, by?: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  set(
    key: string,
    value: unknown,
    opts?: { ex?: number; px?: number },
  ): Promise<unknown>;
  get<T = unknown>(key: string): Promise<T | null>;
} | null {
  const kv = getKv();
  if (!kv || typeof kv.incr !== "function" || typeof kv.expire !== "function") {
    return null;
  }
  return kv as ReturnType<typeof counterKv> & object;
}

/**
 * Bump a run's terminal counter by one. `kind` maps a job outcome to the two
 * display counters: a DONE/SKIPPED_FRESH unit is progress ("done"); a FAILED
 * unit is "failed". Best-effort: swallows every error (degrade open).
 */
export async function incrRunProgress(
  runId: string,
  kind: "done" | "failed",
  by = 1,
): Promise<void> {
  if (!runId || by <= 0) return;
  const kv = counterKv();
  if (!kv) return;
  const key = kind === "done" ? doneKey(runId) : failedKey(runId);
  try {
    await kv.incr(key, by);
    await kv.expire(key, TTL_SEC);
  } catch {
    // Redis hiccup — updateRunProgress re-seeds from the DB next tick.
  }
}

/**
 * Seed/overwrite the authoritative counters from the DB (called by the dispatch
 * tick's updateRunProgress). SET (not INCR) so a re-seed corrects any drift from
 * a dropped INCR. Best-effort.
 */
export async function seedRunProgress(
  runId: string,
  counters: { done: number; failed: number; total: number; status?: string },
): Promise<void> {
  if (!runId) return;
  const kv = counterKv();
  if (!kv) return;
  try {
    // Store totals/counters as bare integers so a later INCR is native. The
    // ioredis client stores via SET (JSON.stringify of a number === the number),
    // and `get` tolerates the round-trip either way.
    await kv.set(doneKey(runId), counters.done, { ex: TTL_SEC });
    await kv.set(failedKey(runId), counters.failed, { ex: TTL_SEC });
    await kv.set(totalKey(runId), counters.total, { ex: TTL_SEC });
    if (counters.status !== undefined) {
      await kv.set(statusKey(runId), counters.status, { ex: TTL_SEC });
    }
  } catch {
    // Non-fatal — the endpoint falls back to a Prisma count on a miss.
  }
}

/**
 * Read a run's counters from Redis only. Returns null when Redis is unavailable
 * OR the run has no counters yet (caller falls back to a Prisma count). A
 * partial set (total missing but done present) still returns numbers (0-filled)
 * so the progress bar can move.
 */
export async function readRunProgress(
  runId: string,
): Promise<RunProgressCounters | null> {
  const kv = counterKv();
  if (!kv) return null;
  try {
    const [done, failed, total, status] = await Promise.all([
      kv.get<number>(doneKey(runId)),
      kv.get<number>(failedKey(runId)),
      kv.get<number>(totalKey(runId)),
      kv.get<string>(statusKey(runId)),
    ]);
    // No counters written at all → signal a miss so the caller re-seeds/falls back.
    if (done == null && failed == null && total == null) return null;
    return {
      done: Number(done ?? 0),
      failed: Number(failed ?? 0),
      total: Number(total ?? 0),
      status: status ?? null,
    };
  } catch {
    return null;
  }
}
