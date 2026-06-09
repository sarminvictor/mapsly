/**
 * Send-window + delay scheduling. The cron enforces the window at send time
 * (leaves a ColdSend PENDING if outside the window), so we only need: add a
 * step delay, and test whether `now` is inside a campaign's local window.
 */
export function addDelay(from: Date, days: number, hours: number): Date {
  return new Date(from.getTime() + days * 86_400_000 + hours * 3_600_000);
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Local hour (0–23) + weekday (0=Sun..6=Sat) for an IANA timezone. */
export function zonedHourWeekday(
  now: Date,
  timeZone: string,
): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const weekday =
    WEEKDAY_INDEX[parts.find((p) => p.type === "weekday")?.value ?? "Mon"] ?? 1;
  return { hour, weekday };
}

export interface SendWindow {
  sendWindowStartHour: number;
  sendWindowEndHour: number;
  sendTimezone: string;
  weekdaysOnly: boolean;
}

export function withinSendWindow(c: SendWindow, now: Date): boolean {
  const { hour, weekday } = zonedHourWeekday(now, c.sendTimezone);
  if (c.weekdaysOnly && (weekday === 0 || weekday === 6)) return false;
  return hour >= c.sendWindowStartHour && hour < c.sendWindowEndHour;
}
