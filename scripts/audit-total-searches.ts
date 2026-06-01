/**
 * Audit · what's actually inside the "Total searches/mo: 64,270" number?
 * Categorise the 205 keywords by likely-duplicate / out-of-city / etc.
 *
 * Read-only · Viktor 2026-05-28.
 */

import prisma from "@/lib/prisma";

const OTHER_CITIES = [
  "edmonton",
  "vancouver",
  "toronto",
  "winnipeg",
  "ottawa",
  "montreal",
  "regina",
  "saskatoon",
  "halifax",
  "fredericton",
];

const fmt = (n: number) => n.toLocaleString("en-US");

async function main() {
  const biz = await prisma.business.findFirst({
    where: { name: { contains: "Injectionist", mode: "insensitive" } },
    select: { id: true, city: true },
  });
  if (!biz) throw new Error("Injectionist not found");
  const ownCity = (biz.city ?? "").toLowerCase();

  const rows = await prisma.businessKeyword.findMany({
    where: { businessId: biz.id },
    select: {
      keyword: { select: { keyword: true, searchVolume: true } },
    },
  });
  type R = { keyword: string; volume: number };
  const data: R[] = rows
    .map((r) => ({
      keyword: r.keyword?.keyword ?? "",
      volume: r.keyword?.searchVolume ?? 0,
    }))
    .filter((r) => r.keyword && r.volume > 0);

  const total = data.reduce((s, r) => s + r.volume, 0);
  console.log(
    `Business · The Injectionist & Aesthetics (Calgary)  ·  ${data.length} keywords with volume  ·  Σ = ${fmt(total)}/mo\n`,
  );

  // BUCKET 1 · keywords mentioning OTHER cities (not Calgary)
  const otherCity = data.filter((r) =>
    OTHER_CITIES.some((c) => r.keyword.toLowerCase().includes(c)),
  );
  const otherCityVol = otherCity.reduce((s, r) => s + r.volume, 0);

  // BUCKET 2 · "near me" keywords (location-vague)
  const nearMe = data.filter((r) => /\bnear\s*me?\b|near ne/i.test(r.keyword));
  const nearMeVol = nearMe.reduce((s, r) => s + r.volume, 0);

  // BUCKET 3 · keywords that explicitly include "calgary"
  const calgary = data.filter((r) => /\bcalgary\b/i.test(r.keyword));
  const calgaryVol = calgary.reduce((s, r) => s + r.volume, 0);

  // BUCKET 4 · neither city nor "near me" (location-free · generic)
  const generic = data.filter(
    (r) =>
      !/\bcalgary\b/i.test(r.keyword) &&
      !/\bnear\s*me?\b|near ne/i.test(r.keyword) &&
      !OTHER_CITIES.some((c) => r.keyword.toLowerCase().includes(c)),
  );
  const genericVol = generic.reduce((s, r) => s + r.volume, 0);

  console.log("HOW THE 64,270 DECOMPOSES BY KEYWORD INTENT");
  console.log(
    `  ${"bucket".padEnd(34)}  ${"# kw".padStart(5)}  ${"Σ vol".padStart(8)}  share`,
  );
  const showBucket = (label: string, list: R[], sum: number) => {
    const pct =
      total > 0 ? `${Math.round((sum / total) * 100)}%`.padStart(5) : " 0%";
    console.log(
      `  ${label.padEnd(34)}  ${list.length.toString().padStart(5)}  ${fmt(sum).padStart(8)}  ${pct}`,
    );
  };
  showBucket("contains 'calgary' (her city)", calgary, calgaryVol);
  showBucket("contains other city (Edmonton+)", otherCity, otherCityVol);
  showBucket("'near me' queries", nearMe, nearMeVol);
  showBucket("location-free / generic", generic, genericVol);
  console.log(`  ${"─".repeat(34)}  ${"─".repeat(5)}  ${"─".repeat(8)}`);
  console.log(
    `  ${"TOTAL".padEnd(34)}  ${data.length.toString().padStart(5)}  ${fmt(total).padStart(8)}`,
  );

  // BUCKET 5 · plural/singular pairs (e.g. "lip injection" + "lip injections")
  // Heuristic: strip trailing "s" or "es" and look for matches.
  const stem = (s: string) =>
    s
      .toLowerCase()
      .replace(/(es|s)\b/g, "")
      .trim();
  const byStem = new Map<string, R[]>();
  for (const r of data) {
    const k = stem(r.keyword);
    const arr = byStem.get(k) ?? [];
    arr.push(r);
    byStem.set(k, arr);
  }
  const pluralPairs = Array.from(byStem.values()).filter((g) => g.length > 1);
  let pluralPairsExtraVol = 0;
  console.log(
    `\nPOTENTIAL PLURAL/SINGULAR DUPLICATES  (${pluralPairs.length} groups)`,
  );
  for (const group of pluralPairs.slice(0, 10)) {
    console.log(
      `  group: ${group.map((g) => `"${g.keyword}" (${g.volume})`).join("  ·  ")}`,
    );
    // "extra" volume = total volume of group minus largest single in group
    const sorted = [...group].sort((a, b) => b.volume - a.volume);
    pluralPairsExtraVol += sorted.slice(1).reduce((s, r) => s + r.volume, 0);
  }
  if (pluralPairs.length > 10) {
    console.log(`  … +${pluralPairs.length - 10} more groups`);
  }
  console.log(
    `  Approx "extra" volume from near-duplicates (group total − biggest member): ${fmt(pluralPairsExtraVol)}`,
  );

  // BUCKET 6 · top 5 highest-volume keywords (most-contributing)
  const top5 = [...data].sort((a, b) => b.volume - a.volume).slice(0, 10);
  console.log(`\nTOP 10 KEYWORDS BY VOLUME (these dominate the 64,270 total)`);
  for (const r of top5) {
    console.log(`  ${r.volume.toString().padStart(6)}  ${r.keyword}`);
  }
  console.log(
    `  Σ top 10 = ${fmt(top5.reduce((s, r) => s + r.volume, 0))} = ${Math.round((top5.reduce((s, r) => s + r.volume, 0) / total) * 100)}% of total`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
