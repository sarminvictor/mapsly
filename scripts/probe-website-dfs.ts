/**
 * RESEARCH PROBE · website-intelligence DataForSEO endpoint survey.
 *
 * One-off, manual, read-only-to-our-DB. For ONE target business (default:
 * The Injectionist) + its top same-cell competitors, it calls the
 * website-relevant DataForSEO endpoints and prints, per endpoint:
 *   - operation + path + the real DataForSEO per-call cost
 *   - a trimmed, human-readable view of what we'd collect
 * and finally a "you vs competitors vs average" comparison table — the exact
 * shape the redesigned /website page needs.
 *
 * Endpoints probed:
 *   1. on_page/lighthouse/live/json   — via prod composer `lighthouseFullAudit`
 *      (Core Web Vitals + scores + DOM checks) · already wired
 *   2. on_page/instant_pages          — single-page on-page audit, NO crawl
 *      (onpage_score + checks + page timing) · NOT wired yet · cheap
 *   3. domain_analytics/technologies  — what the site is built with · NOT wired
 *
 * Run:
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx \
 *     scripts/probe-website-dfs.ts ["Name fragment" | businessId]
 *
 * Cost: lighthouse ~$0.0025 + 4× instant_pages + 1× technologies ≈ < $0.20.
 * Real total is printed at the end (read from DataForSEO task.cost).
 */

import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";
import { dataforSeoPost } from "@/services/dataforseo";
import { lighthouseFullAudit } from "@/services/lighthouse/audit";

function pretty(v: unknown, max = 1400): string {
  const s = JSON.stringify(v, null, 2);
  return s.length > max ? s.slice(0, max) + `\n… [truncated]` : s;
}

function domainOf(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const u = new URL(website.startsWith("http") ? website : `https://${website}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? null;
  }
}
function urlOf(website: string | null | undefined): string | null {
  const d = domainOf(website);
  return d ? `https://${d}/` : null;
}

interface InstantSummary {
  name: string;
  domain: string;
  onpageScore: number | null;
  domCompleteMs: number | null;
  ttiMs: number | null;
  failedChecks: string[];
  costUsd: number;
}

async function instantPage(name: string, website: string): Promise<InstantSummary | null> {
  const url = urlOf(website);
  const domain = domainOf(website);
  if (!url || !domain) return null;
  try {
    const { result, rawCostUsd } = await dataforSeoPost<{
      items?: Array<{
        onpage_score?: number;
        page_timing?: { dom_complete?: number; time_to_interactive?: number };
        checks?: Record<string, boolean>;
      }>;
    }>({
      operation: "on_page.instant_pages",
      path: "/v3/on_page/instant_pages",
      body: { url, enable_javascript: true },
      timeoutMs: 60_000,
    });
    const item = result?.[0]?.items?.[0];
    const checks = item?.checks ?? {};
    // In DataForSEO on-page checks, a TRUE value on a "no_*"/"is_*"/"has_*"
    // problem flag means the issue is present. Surface the ones that are true.
    const PROBLEM = [
      "no_title", "no_description", "no_h1_tag", "no_image_alt",
      "no_favicon", "https_to_http_links", "is_http", "is_4xx_code",
      "is_5xx_code", "canonical_chain", "no_doctype", "low_content_rate",
      "title_too_long", "title_too_short", "no_content_encoding",
      "high_loading_time", "small_page_size", "no_meta_viewport",
    ];
    const failed = PROBLEM.filter((k) => checks[k] === true);
    return {
      name,
      domain,
      onpageScore: item?.onpage_score ?? null,
      domCompleteMs: item?.page_timing?.dom_complete ?? null,
      ttiMs: item?.page_timing?.time_to_interactive ?? null,
      failedChecks: failed,
      costUsd: rawCostUsd ?? 0,
    };
  } catch (err) {
    console.log(`   ✗ instant_pages(${domain}) failed: ${(err as Error).message}`);
    return null;
  }
}

async function main() {
  const arg = process.argv[2] ?? "Injection";
  const target = await prisma.business.findFirst({
    where: arg.length > 24 && !arg.includes(" ")
      ? { id: arg }
      : { name: { contains: arg, mode: "insensitive" } },
    select: {
      id: true, name: true, website: true, category: true,
      city: true, country: true, address: true, phone: true,
    },
  });
  if (!target) {
    console.log(`No business matched "${arg}".`);
    return;
  }

  console.log("=".repeat(74));
  console.log(`TARGET  ${target.name}`);
  console.log(`  ${target.category} · ${target.city}, ${target.country}`);
  console.log(`  website: ${target.website ?? "(none)"} → domain: ${domainOf(target.website) ?? "(none)"}`);
  console.log("=".repeat(74));

  if (!target.website) {
    console.log("Target has no website on record — nothing to audit.");
    return;
  }

  // Same-cell competitors (the exact dedup key our cell model uses).
  const competitors = await prisma.business.findMany({
    where: {
      id: { not: target.id },
      category: target.category,
      city: target.city,
      country: target.country,
      website: { not: null },
    },
    select: { name: true, website: true, reviewCount: true },
    orderBy: { reviewCount: "desc" },
    take: 3,
  });
  console.log(`\nSame-cell competitors with a website (top ${competitors.length} by review count):`);
  for (const c of competitors) console.log(`  · ${c.name} → ${domainOf(c.website)}`);

  await withCronRun("probe:website-dfs", async () => {
    // ---- 1 · Lighthouse (prod composer) on the target ------------------
    console.log(`\n${"-".repeat(74)}\n1 · on_page/lighthouse/live/json  (prod path · lighthouseFullAudit)\n${"-".repeat(74)}`);
    try {
      const lh = await lighthouseFullAudit({
        url: target.website!,
        nap: { name: target.name, address: target.address ?? undefined, phone: target.phone ?? undefined },
      });
      console.log("scores:", pretty(lh.scores, 900));
      console.log("domChecks:", pretty(lh.domChecks, 600));
      console.log("partial:", lh.partial, "· legs:", pretty(lh.legs, 300));
    } catch (err) {
      console.log(`   ✗ lighthouse failed: ${(err as Error).message}`);
    }

    // ---- 2 · instant_pages on target + competitors (comparison) --------
    console.log(`\n${"-".repeat(74)}\n2 · on_page/instant_pages  (NOT wired yet · target + competitors)\n${"-".repeat(74)}`);
    const rows: InstantSummary[] = [];
    const t0 = await instantPage(`★ ${target.name}`, target.website!);
    if (t0) rows.push(t0);
    for (const c of competitors) {
      if (!c.website) continue;
      const r = await instantPage(c.name, c.website);
      if (r) rows.push(r);
    }

    // ---- 3 · technologies on the target --------------------------------
    console.log(`\n${"-".repeat(74)}\n3 · domain_analytics/technologies  (NOT wired yet · target)\n${"-".repeat(74)}`);
    try {
      const { result, rawCostUsd } = await dataforSeoPost<{
        domain?: string;
        technologies?: Record<string, unknown>;
      }>({
        operation: "domain_analytics.technologies",
        path: "/v3/domain_analytics/technologies/technologies/live",
        body: { target: domainOf(target.website) },
        timeoutMs: 60_000,
      });
      console.log(`cost: $${(rawCostUsd ?? 0).toFixed(5)}`);
      console.log("technologies:", pretty(result?.[0]?.technologies, 900));
    } catch (err) {
      console.log(`   ✗ technologies failed: ${(err as Error).message}`);
    }

    // ---- comparison table ----------------------------------------------
    if (rows.length > 0) {
      const scores = rows.map((r) => r.onpageScore).filter((n): n is number => n != null);
      const loads = rows.map((r) => r.domCompleteMs).filter((n): n is number => n != null);
      const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      const avgLoad = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : null;
      console.log(`\n${"=".repeat(74)}\nCOMPARISON · you vs competitors vs average (from instant_pages)\n${"=".repeat(74)}`);
      console.log("business".padEnd(34), "onpage".padStart(7), "load(ms)".padStart(9), "  issues");
      for (const r of rows) {
        console.log(
          r.name.slice(0, 33).padEnd(34),
          (r.onpageScore?.toFixed(1) ?? "—").padStart(7),
          (r.domCompleteMs?.toString() ?? "—").padStart(9),
          `  ${r.failedChecks.length} (${r.failedChecks.slice(0, 4).join(", ")})`,
        );
      }
      console.log("-".repeat(74));
      console.log(
        "CELL AVERAGE".padEnd(34),
        (avgScore?.toFixed(1) ?? "—").padStart(7),
        (avgLoad ? Math.round(avgLoad).toString() : "—").padStart(9),
      );
      const instantCost = rows.reduce((a, r) => a + r.costUsd, 0);
      console.log(`\ninstant_pages total cost: $${instantCost.toFixed(5)} for ${rows.length} pages (~$${(instantCost / rows.length).toFixed(5)}/page)`);
    }
  });

  console.log("\n✓ probe complete. (CronRun cost row written for audit trail.)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
