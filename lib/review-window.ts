/**
 * The ONE canonical time window for "mentioned N times" service-mention
 * counts. Both surfaces that show these numbers MUST use it:
 *
 *   - SMB portal /reviews ServiceMentionsCard (modules/reviews/trends.ts)
 *   - /l landing "What services {noun} mention" block (modules/smb-landing)
 *
 * History: the landing originally counted all-time while the portal counted
 * 12 calendar buckets — the same business showed "Dermal fillers 25" on /l
 * and "21" on /reviews. Same DB, different windows, looked like fake numbers
 * (Viktor caught it 2026-06-10). Never let these drift again: import this
 * helper, don't inline a cutoff.
 */

/** UTC first-of-month `monthsBack` months before `from`. Month-arithmetic
 * (not day-arithmetic) so a Jan 31 "minus 11 months" can't skip/duplicate a
 * bucket (see modules/reviews/trends.ts trend-chart incident note). */
export function monthStart(from: Date, monthsBack: number): Date {
  const total = from.getUTCFullYear() * 12 + from.getUTCMonth() - monthsBack;
  const year = Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12; // 0–11, normalized for negatives
  return new Date(Date.UTC(year, month, 1));
}

/** Start of the service-mention counting window: 12 calendar buckets
 * including the current month (first of the month, 11 months back). */
export function serviceMentionWindowStart(now: Date = new Date()): Date {
  return monthStart(now, 11);
}
