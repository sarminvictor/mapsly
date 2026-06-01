/**
 * Research probe (read-only analysis) · runs the SERVICE+CITY keyword search
 * "Botox miami" through our actor — Viktor's proposed market-discovery pattern —
 * and reports: relevance, distinct advertiser pages (id + name + platforms),
 * platform distribution, and what fields we capture vs. what the Ad Library UI
 * shows (handle, followers, category). NOT a feature — a measurement.
 *
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/probe-botox-miami.ts
 */

import { withCronRun } from "@/lib/cost/cost-counter";
import { metaAdLibrarySearch } from "@/services/apify";

async function main() {
  const t0 = Date.now();
  const { rows, usageTotalUsd } = await withCronRun(
    "manual:probe-botox-miami",
    () =>
      metaAdLibrarySearch({
        searchTerms: ["Botox miami"],
        countries: ["US"],
        activeStatus: "active",
        maxItems: 120,
      }),
  );
  console.log(
    `\nDONE ${Math.round((Date.now() - t0) / 1000)}s · ${rows.length} ads · $${usageTotalUsd}\n`,
  );

  // Distinct advertiser pages — the discovery payload.
  const pages = new Map<
    string,
    { name: string; count: number; platforms: Set<string>; sample: string }
  >();
  const platformTotals = new Map<string, number>();
  for (const r of rows) {
    const key = r.pageId || r.pageName || "?";
    const g =
      pages.get(key) ??
      pages
        .set(key, {
          name: r.pageName ?? "?",
          count: 0,
          platforms: new Set<string>(),
          sample: "",
        })
        .get(key)!;
    g.count += 1;
    for (const p of r.platforms ?? []) {
      g.platforms.add(p);
      platformTotals.set(p, (platformTotals.get(p) ?? 0) + 1);
    }
    if (!g.sample && r.adCreativeBody) g.sample = r.adCreativeBody.slice(0, 60);
  }

  console.log(`=== DISTINCT ADVERTISER PAGES: ${pages.size} ===`);
  const sorted = [...pages.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [pid, g] of sorted.slice(0, 25)) {
    console.log(
      `  ${g.name}  ·  pageId=${pid}  ·  ${g.count} ads  ·  [${[...g.platforms].join(",")}]`,
    );
    if (g.sample) console.log(`      "${g.sample}…"`);
  }

  console.log(`\n=== PLATFORM DISTRIBUTION (ad-level) ===`);
  for (const [p, n] of [...platformTotals.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${p}: ${n}`);
  }

  // What fields does our actor capture vs. the UI "About the advertiser" panel?
  const sample = rows[0];
  console.log(`\n=== FIELD CAPTURE (sample ad) ===`);
  console.log(
    JSON.stringify(
      {
        id: sample?.id,
        pageId: sample?.pageId,
        pageName: sample?.pageName,
        platforms: sample?.platforms,
        displayFormat: sample?.displayFormat,
        ctaText: sample?.ctaText,
        linkUrl: sample?.linkUrl,
        startDate: sample?.startDate,
        isActive: sample?.isActive,
        collationCount: sample?.collationCount,
        // NOT captured today (in the UI "About the advertiser"): @handle,
        // followerCount, page category, "More info" services.
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
