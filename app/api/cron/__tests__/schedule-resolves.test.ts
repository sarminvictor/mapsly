// WP10-2 · CI guard: every cron path scheduled in vercel.json MUST resolve to a
// route handler on disk. Prevents the doc/schedule drift the Part I audit found
// (data-cadence.md claimed ~14 crons; vercel.json scheduled 4). If someone
// schedules a path with no handler — or renames a handler out from under a
// schedule — this fails the build instead of failing silently in production.

import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import vercelConfig from "../../../../vercel.json";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

interface CronEntry {
  path: string;
  schedule: string;
}

const crons: CronEntry[] = (vercelConfig.crons ?? []) as CronEntry[];

describe("vercel.json cron schedule", () => {
  it("declares at least one cron", () => {
    expect(crons.length).toBeGreaterThan(0);
  });

  it.each(crons)("path %s resolves to a route handler on disk", ({ path }) => {
    // "/api/cron/internal/dispatch" -> "app/api/cron/internal/dispatch/route.ts"
    expect(path.startsWith("/api/cron/")).toBe(true);
    const routeFile = join(REPO_ROOT, "app", path.slice(1), "route.ts");
    expect(
      existsSync(routeFile),
      `scheduled cron "${path}" has no handler at ${routeFile}`,
    ).toBe(true);
  });

  it("every schedule string is a 5-field cron expression", () => {
    for (const { path, schedule } of crons) {
      const fields = schedule.trim().split(/\s+/);
      expect(fields.length, `bad schedule for ${path}: "${schedule}"`).toBe(5);
    }
  });
});
