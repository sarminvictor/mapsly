/**
 * Verify the shared website collector (the core of the admin "Run Website"
 * button + the weekly cron). Runs `collectWebsiteForBatch` on one business
 * inside a CronRun, then confirms a LighthouseAudit row actually persisted —
 * proving the rawJson-strip fix works end to end.
 *
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx \
 *     scripts/verify-website-collect.ts ["Name fragment"]
 */
import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";
import { collectWebsiteForBatch } from "@/modules/website-intel/collect-website-intel";

async function main() {
  const arg = process.argv[2] ?? "Injection";
  const biz = await prisma.business.findFirst({
    where: { name: { contains: arg, mode: "insensitive" } },
    select: { id: true, name: true, website: true },
  });
  if (!biz) {
    console.log(`No business matched "${arg}".`);
    return;
  }
  console.log(`Target: ${biz.name} · ${biz.website ?? "(no website)"}`);

  const before = await prisma.lighthouseAudit.count({
    where: { businessId: biz.id },
  });

  const result = await withCronRun("verify:website-collect", async () =>
    collectWebsiteForBatch([biz.id]),
  );
  console.log("\ncollectWebsiteForBatch result:", JSON.stringify(result));

  const after = await prisma.lighthouseAudit.count({
    where: { businessId: biz.id },
  });
  console.log(`LighthouseAudit rows: ${before} → ${after}`);

  const latest = await prisma.lighthouseAudit.findFirst({
    where: { businessId: biz.id },
    orderBy: { auditedAt: "desc" },
    select: {
      auditedAt: true,
      performance: true,
      seo: true,
      lcp: true,
      cls: true,
      contentWithoutJs: true,
      desktopPerformance: true,
      desktopLcp: true,
      desktopInp: true,
      desktopCls: true,
    },
  });
  console.log("\nnewest row:", JSON.stringify(latest, null, 2));
  console.log(
    after > before
      ? "\n✓ PERSISTED — manual path writes a LighthouseAudit row (rawJson fix confirmed)."
      : "\n✗ NO new row — investigate (errors above?).",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
