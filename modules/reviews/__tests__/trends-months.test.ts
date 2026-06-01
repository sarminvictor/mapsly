// Regression guard for INC-2026-05-29-41 · the 12-month trend window must
// always yield exactly 12 UNIQUE, strictly-sequential month buckets — for
// EVERY run date. The original `setUTCMonth(m - i)` kept the source day (e.g.
// 29) and, when the window crossed a short month (Feb 29 in a non-leap year),
// JS rolled it into the next month — skipping February, duplicating March, and
// crashing the trend chart with a React duplicate-key error on the 29th–31st.

import { describe, expect, test } from "vitest";
import { __test } from "../trends";

const { buildEmpty12Months } = __test;

// Dates that historically broke (or could break) the window: month-ends that
// straddle February, leap day, and year boundaries.
const RISKY_DATES = [
  "2026-05-29", // the reported trigger
  "2026-03-31", // crosses Feb (non-leap) from the high side
  "2026-01-31", // Jan 31 → window spans multiple short months
  "2024-02-29", // leap day itself
  "2026-12-31", // year boundary at day 31
  "2025-08-31",
  "2027-07-30",
];

describe("buildEmpty12Months", () => {
  test.each(RISKY_DATES)("%s → 12 unique, sequential months", (iso) => {
    const months = buildEmpty12Months(new Date(`${iso}T12:00:00Z`)).map(
      (b) => b.month,
    );

    expect(months).toHaveLength(12);
    expect(new Set(months).size).toBe(12); // no duplicate keys

    // Strictly sequential: each bucket is exactly one calendar month after
    // the previous one.
    for (let i = 1; i < months.length; i++) {
      const [py, pm] = months[i - 1].split("-").map(Number);
      const [cy, cm] = months[i].split("-").map(Number);
      expect(cy * 12 + cm).toBe(py * 12 + pm + 1);
    }
  });

  test("ends on the run month, starts 11 months earlier", () => {
    const months = buildEmpty12Months(new Date("2026-05-29T12:00:00Z")).map(
      (b) => b.month,
    );
    expect(months[11]).toBe("2026-05");
    expect(months[0]).toBe("2025-06");
    expect(months).toContain("2026-02"); // February is NOT skipped
  });
});
