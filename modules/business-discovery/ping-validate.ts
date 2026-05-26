/**
 * Cell validation · confirms (category × location × radius) yields data.
 *
 * Before we let an admin add a `TrackedLocation` row, we ping DataForSEO
 * Maps with `limit: 1` to confirm there's at least one business of the
 * given category within radius. If empty, the cell is rejected with a
 * clear message ("no businesses found here") instead of creating a
 * dead registry entry that admin would have to clean up later.
 *
 * Cost: $0.001 per ping (one Live tier call). The same Maps endpoint
 * with limit=100 we'd use for a real run, just capped. Caching means
 * repeated pings within 24h are free.
 *
 * Per `.claude/rules/cost-discipline.md` every DataForSEO call must
 * run inside an open `CronRun`. Admin-triggered work isn't a cron in
 * the scheduled sense, but it IS a tracked, server-side ledger entry
 * — we wrap each ping in `withCronRun("admin:discovery-ping", …)` so
 * the cost lands in the unified ledger plus the call attribution
 * stays consistent with every other DataForSEO caller.
 *
 * Returns `{ ok: false, reason }` for typed failure cases so the UI
 * can render a clean error message.
 */

import { withCronRun } from "@/lib/cost/cost-counter";
import { mapsSearch } from "@/services/dataforseo";

export type PingValidateResult =
  | { ok: true; sampleName: string; sampleCategory: string }
  | { ok: false; reason: "empty" | "error"; message: string };

export async function pingValidateLocation(input: {
  dataforseoCategoryId: string;
  lat: number;
  lng: number;
  radiusKm: number;
}): Promise<PingValidateResult> {
  const { dataforseoCategoryId, lat, lng, radiusKm } = input;
  try {
    const result = await withCronRun("admin:discovery-ping", () =>
      mapsSearch({
        categories: [dataforseoCategoryId],
        location_coordinate: `${lat.toFixed(6)},${lng.toFixed(6)},${radiusKm}`,
        language_code: "en",
        limit: 1,
      }),
    );
    const first = result.items[0];
    if (!first) {
      return {
        ok: false,
        reason: "empty",
        message: `No businesses found for "${dataforseoCategoryId}" within ${radiusKm}km of (${lat.toFixed(4)}, ${lng.toFixed(4)}). Try a wider radius or a nearby metro centroid.`,
      };
    }
    return {
      ok: true,
      sampleName: first.title ?? "(unnamed)",
      sampleCategory: first.category ?? dataforseoCategoryId,
    };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message:
        err instanceof Error
          ? `Validation call failed: ${err.message}`
          : "Validation call failed.",
    };
  }
}
