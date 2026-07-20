/**
 * `/sitemap.xml` · request-time route handler (replaces `app/sitemap.ts`).
 *
 * INC-2026-07-20-66: under `cacheComponents`, metadata-route files are
 * ALWAYS statically prerendered at build — so the INC-27 build guard's
 * empty biz list was baked into the shipped sitemap and the entire /biz
 * pSEO surface was invisible to Google. This handler renders per request
 * (`await connection()`), with Vercel's CDN as the cache layer.
 *
 * Degradation semantics (the part that matters):
 *   - Google treats a 5xx sitemap as TRANSIENT — it keeps the previously
 *     fetched copy and retries. An empty/shrunken 200 is AUTHORITATIVE —
 *     it starts dropping URLs from discovery.
 *   - Therefore: query error → 503 (no-store, Retry-After) and a shrink
 *     guard serves 503 if the biz count collapses below MIN_EXPECTED_BIZ.
 *     Success responses are CDN-cached (s-maxage=3600) with
 *     stale-while-revalidate=86400, so the CDN's stale copy IS the
 *     last-known-good store during transient DB failures — 503s are
 *     no-store and never evict it.
 *
 * Logging per `.claude/rules/observability.md` (single-line JSON; Sentry
 * SDK not installed yet — Phase 8).
 */

import { connection } from "next/server";

import {
  buildBizEntries,
  buildSitemapXml,
  buildStaticEntries,
} from "@/lib/seo/sitemap-xml";
import { listBizSitemapEntries } from "@/modules/biz-profile/queries";
import type { BizSitemapEntry } from "@/modules/biz-profile/types";

/**
 * Bounded enumeration. The binding cap is Vercel's 10MB CDN-cacheable
 * response ceiling (~3,300 gated businesses at measured ~2.98KB each) —
 * past it every crawler fetch becomes an origin run, defeating the CDN
 * layer. Shard into a sitemapindex at ~2,500 gated businesses; this hard
 * limit stays below the cliff so it can actually protect the CDN path.
 */
const SITEMAP_BIZ_LIMIT = 3000;

/**
 * Shrink guard floor. The tier-1 gate yields ~327 businesses (2026-07-20);
 * a result below this floor means something upstream broke (bad deploy,
 * schema drift, mass deactivation) — serve 503 rather than teach Google a
 * shrunken URL set. Raise alongside tier expansions.
 */
const MIN_EXPECTED_BIZ = 100;

/** Warn well before Vercel's 10MB CDN-cacheable response ceiling. */
const SIZE_WARN_BYTES = 4_000_000;

function unavailable(
  reason: string,
  detail: Record<string, unknown>,
): Response {
  console.error(
    JSON.stringify({
      level: "error",
      event: "sitemap.unavailable",
      reason,
      ...detail,
    }),
  );
  return new Response(null, {
    status: 503,
    headers: {
      "Retry-After": "3600",
      // Never let the CDN cache the error path — the cached GOOD copy must
      // keep serving through its stale-while-revalidate window instead.
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(): Promise<Response> {
  // MUST be the first await and MUST stay outside any try/catch: the
  // prerender bail-out works by throwing, and a wrapping catch would
  // swallow it and bake this handler's output at build — the exact bug
  // this file exists to fix (INC-2026-07-20-66).
  await connection();

  let biz: BizSitemapEntry[];
  try {
    biz = await listBizSitemapEntries(SITEMAP_BIZ_LIMIT);
  } catch (err) {
    return unavailable("query_failed", { message: String(err).slice(0, 300) });
  }

  if (biz.length < MIN_EXPECTED_BIZ) {
    return unavailable("shrink_guard", {
      count: biz.length,
      floor: MIN_EXPECTED_BIZ,
    });
  }

  const xml = buildSitemapXml([
    ...buildStaticEntries(),
    ...buildBizEntries(biz),
  ]);

  const xmlBytes = Buffer.byteLength(xml);
  if (xmlBytes > SIZE_WARN_BYTES) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "sitemap.size_warning",
        bytes: xmlBytes,
        cdnCacheableCap: 10_000_000,
        action: "shard into a sitemapindex before this hits the cap",
      }),
    );
  }

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Browsers: always revalidate. Vercel CDN (CDN-Cache-Control wins
      // there): cache 1h, serve stale up to 24h while re-fetching.
      "Cache-Control": "public, max-age=0, must-revalidate",
      "CDN-Cache-Control":
        "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
