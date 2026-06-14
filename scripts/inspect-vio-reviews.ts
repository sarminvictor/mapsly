// scripts/inspect-vio-reviews.ts — one-off · re-fetch VIO's DfS review task and
// print each review's raw timestamp + whether it falls inside the 12-month
// window. Tells us why the upsert inserted 0 of 20 (old reviews → cutoff?).
import { config } from "dotenv";
config({ path: ".env.local" });

import { withCronRun } from "@/lib/cost/cost-counter";
import { reviewsTaskGet } from "@/services/dataforseo";

const taskId = "06122214-1249-0298-0000-46bd81dbf9f2";

async function main() {
  const res = await withCronRun("script:inspect-vio-reviews", () =>
    reviewsTaskGet(taskId),
  );
  console.log(
    "items:",
    res.items.length,
    "· totalReviewsCount:",
    res.totalReviewsCount,
    "· aggregateRating:",
    res.aggregateRating,
  );
  const now = Date.now();
  const YR = 365 * 24 * 3600 * 1000;
  let within = 0;
  for (const it of res.items as Array<Record<string, unknown>>) {
    const ts = it.timestamp as string | undefined;
    const d = ts ? new Date(ts) : null;
    const ok = !!d && !Number.isNaN(d.getTime()) && now - d.getTime() < YR;
    if (ok) within++;
    const rating = (it.rating as { value?: number } | undefined)?.value;
    console.log(JSON.stringify({ id: it.review_id, ts, rating, withinYr: ok }));
  }
  console.log("==== WITHIN 12 MONTHS:", within, "of", res.items.length, "====");
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
