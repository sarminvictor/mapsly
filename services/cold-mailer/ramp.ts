/**
 * Cold-start ramp schedule — pure functions (unit-tested).
 *
 * A brand-new, unwarmed mailbox must NOT blast on day 1. We ramp the per-mailbox
 * daily cap gently and only reach the mailbox's target `dailyCap` after ~a week.
 */

/**
 * Per-mailbox daily volume by ramp-day (0-based). Beyond the array → target dailyCap.
 * Tuned LOW for Zoho mailboxes: Zoho's "Unusual sending activity" detector trips
 * early on brand-new boxes/domains, so start at a trickle and climb gently to ~18.
 */
export const COLD_RAMP_STEPS: readonly number[] = [3, 4, 5, 7, 9, 12, 15, 18];

/** UTC YYYY-MM-DD key for daily counters. */
export function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Effective daily cap for a mailbox given its target cap + ramp start.
 * - `rampStartedAt` null  → 0 (mailbox is still warming, not sending yet)
 * - otherwise the lesser of the ramp-step for the elapsed day and the target cap.
 */
export function effectiveDailyCap(
  dailyCap: number,
  rampStartedAt: Date | null,
  now: Date,
): number {
  if (!rampStartedAt) return 0;
  const elapsedDays = Math.floor(
    (now.getTime() - rampStartedAt.getTime()) / 86_400_000,
  );
  if (elapsedDays < 0) return 0;
  const step =
    elapsedDays < COLD_RAMP_STEPS.length
      ? COLD_RAMP_STEPS[elapsedDays]
      : dailyCap;
  return Math.min(step, dailyCap);
}
