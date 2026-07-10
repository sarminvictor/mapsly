// Redis-backed idle gate for frequent crons · the Neon-suspend enabler.
//
// WHY: Neon bills compute-hours = CU-size × hours-awake, and the endpoint only
// suspends after ~5 min with ZERO DB queries. A cron that touches Postgres more
// often than that (dispatch runs every 2 min) keeps the endpoint awake 24/7 —
// paying for a machine that, on an idle tick, does ~8 throwaway queries and
// finds nothing to do. This gate lets a provably-idle tick return WITHOUT
// touching Prisma, so Neon can actually sleep between real bursts of work.
//
// CORRECTNESS CONTRACT — the gate is an OPTIMISATION, never load-bearing:
//   1. Fails OPEN. Redis absent (getKv()===null) OR unreachable (a thrown
//      command) → run the tick, exactly as today. An unset-vs-error ambiguity
//      NEVER causes a skip. Worst case is "endpoint stays awake", never
//      "work silently dropped".
//   2. Wake flag. Every enqueue site calls markCronWork(job) → the next tick
//      runs. So new user-triggered work is picked up on the same cadence as
//      today (≤ the cron interval).
//   3. Safety scan. Even with the flag unset, a full tick is FORCED at least
//      every SAFETY_MS. This is the backstop for TIME-DELAYED work that has no
//      fresh enqueue — backoff-requeued jobs (future nextAttemptAt),
//      reconcileStuck resets, scheduled follow-up sends, meta-reconcile
//      continuations. SAFETY_MS > Neon's 5-min suspend window, so the endpoint
//      still gets real sleep between safety scans; the cost is that a lost/never
//      -set flag delays pickup by at most SAFETY_MS (vs the cron interval),
//      which for already-minutes-delayed retry work is immaterial.
//
// Per .claude/rules/incident-prevention.md this mirrors
// modules/enrichment/run-progress-counter.ts: every Redis call is try/caught
// and degrades open.

import { getKv } from "@/lib/cache/kv";

/**
 * Canonical gated-cron job names · single source of truth shared by each cron
 * route (its shouldRunCronTick/recordCronTick) and every enqueue site
 * (markCronWork), so the wake-flag key can never drift between producer and
 * consumer. These strings equal the routes' existing `JOB` / withCronRun labels.
 */
export const GATED_CRON = {
  dispatch: "enrichment:dispatch",
  runFinishedEmails: "internal:run-finished-emails",
  metaReconcile: "meta:reconcile",
} as const;

/** `1` when work is pending for <job>; absent when the queue is believed drained. */
const wakeKey = (job: string): string => `cron:${job}:wake`;
/** Epoch-ms of the last FULL (non-skipped) tick — drives the safety scan. */
const lastFullKey = (job: string): string => `cron:${job}:lastfull`;

/**
 * Force a full tick at least this often even when the wake flag is unset. 13 min
 * is deliberately > Neon's ~5-min suspend threshold (so idle windows still let
 * the endpoint sleep) while bounding worst-case pickup of time-delayed work.
 */
const DEFAULT_SAFETY_MS = 13 * 60_000;

/**
 * Wake flag TTL. Self-expires so a crash BETWEEN "set flag" and the drain that
 * would clear it can never pin the cron awake forever — the safety scan resumes
 * ownership. 30 min comfortably outlives any single run's active phase (the flag
 * is refreshed by each enqueue + kept alive while work remains).
 */
const WAKE_TTL_SEC = 30 * 60;

/** Feature-detect a get/set/del-capable client; null → caller fails open. */
function gateKv(): Pick<
  NonNullable<ReturnType<typeof getKv>>,
  "get" | "set" | "del"
> | null {
  const kv = getKv();
  if (
    !kv ||
    typeof kv.get !== "function" ||
    typeof kv.set !== "function" ||
    typeof kv.del !== "function"
  ) {
    return null;
  }
  return kv;
}

/**
 * ENQUEUE SIDE. Signal that <job> now has work, so the next cron tick runs
 * instead of skipping. Call this wherever a row a gated cron drains is created
 * or armed (PENDING run/discovery, campaign activated, run closed, etc.).
 * Best-effort — a Redis miss just means the safety scan picks the work up.
 */
export async function markCronWork(job: string): Promise<void> {
  const kv = gateKv();
  if (!kv) return;
  try {
    await kv.set(wakeKey(job), 1, { ex: WAKE_TTL_SEC });
  } catch {
    // Degrade open — the safety scan is the backstop.
  }
}

/**
 * CRON SIDE · call at the very top of the handler, BEFORE any Prisma / CronRun
 * open. Returns true → do the tick's DB work; false → skip (touch zero Prisma).
 * Fails OPEN on any Redis uncertainty.
 */
export async function shouldRunCronTick(
  job: string,
  safetyMs: number = DEFAULT_SAFETY_MS,
): Promise<boolean> {
  const kv = gateKv();
  if (!kv) return true; // Redis not configured → run (today's behavior)
  try {
    const wake = await kv.get(wakeKey(job));
    if (wake != null) return true; // work pending → run
    const last = await kv.get<number>(lastFullKey(job));
    if (last == null) return true; // no baseline yet → run (and stamp below)
    return Date.now() - Number(last) >= safetyMs; // safety scan due?
  } catch {
    return true; // Redis unreachable → run
  }
}

/**
 * CRON SIDE · call AFTER a tick that RAN. Stamps the safety-scan clock, then:
 *   - idle  → clears the wake flag so subsequent ticks can skip and Neon sleeps;
 *   - !idle → REFRESHES the wake flag's TTL so a run that outlives WAKE_TTL_SEC
 *             (long meta collections can run for many minutes) never has its
 *             flag expire mid-flight and get its ticks skipped — the fast
 *             cadence holds until the queue truly empties.
 * Pass `idle: false` whenever ANY work remains (pending/running rows, more work
 * queued).
 */
export async function recordCronTick(
  job: string,
  opts: { idle: boolean },
): Promise<void> {
  const kv = gateKv();
  if (!kv) return;
  try {
    await kv.set(lastFullKey(job), Date.now(), { ex: WAKE_TTL_SEC * 2 });
    if (opts.idle) {
      await kv.del(wakeKey(job));
    } else {
      // Work remains — keep the flag alive so the next tick runs (not skipped).
      await kv.set(wakeKey(job), 1, { ex: WAKE_TTL_SEC });
    }
  } catch {
    // Degrade open — a missed clear/refresh just means one more (or one fewer)
    // full tick next cycle; the safety scan bounds either direction.
  }
}
