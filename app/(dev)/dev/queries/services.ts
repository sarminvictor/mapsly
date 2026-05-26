// Service health: env-var presence + connectivity pings to external dependencies.
//
// IMPORTANT: process.env on the deployed app reads from VERCEL PROJECT ENV VARS,
// not from your local .env.local. To make a service show "ok" here, set the
// env var in Vercel → Settings → Environment Variables and redeploy.

import { cacheLife, cacheTag } from "next/cache";

export interface ServiceStatus {
  name: string;
  category: "core" | "ai" | "data" | "billing" | "comms" | "observability";
  configured: boolean;
  reachable: boolean | null;
  /** Which env var(s) we look for. Surfaced in the UI so you know exactly what to set. */
  expects: string;
  /** Where the user fixes it. */
  where: "vercel-env" | "vercel-storage" | "third-party-account";
  detail: string;
  /** Optional services don't surface as "you forgot to do this" — they're deferred to a later phase. */
  optional?: { phase: string; reason: string };
}

async function pingHead(url: string, ms = 2000): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function getServiceHealth(): Promise<ServiceStatus[]> {
  "use cache";
  cacheLife("days");
  cacheTag("dev-dashboard-services");

  const dbUrl = process.env.DATABASE_URL;
  const dbHost = dbUrl
    ? new URL(dbUrl.replace(/^postgresql/, "https")).host
    : null;

  return [
    {
      name: "Neon Postgres",
      category: "core",
      expects: "DATABASE_URL",
      where: "vercel-env",
      configured: !!dbUrl,
      reachable: dbHost ? await pingHead(`https://${dbHost}`) : null,
      detail: dbHost ?? "DATABASE_URL not set",
    },
    {
      name: "GitHub API",
      category: "core",
      expects: "GITHUB_TOKEN",
      where: "vercel-env",
      configured: !!process.env.GITHUB_TOKEN,
      reachable: await pingHead("https://api.github.com"),
      detail: "REST + Contents API",
    },
    {
      name: "OpenAI",
      category: "ai",
      expects: "OPENAI_API_KEY",
      where: "vercel-env",
      configured: !!process.env.OPENAI_API_KEY,
      reachable: await pingHead("https://api.openai.com"),
      detail: "gpt-5.4-mini / nano · review sentiment + reply drafts + copy",
    },
    {
      name: "DataForSEO",
      category: "data",
      expects: "DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD",
      where: "vercel-env",
      // Accept both modern (LOGIN) and legacy (USERNAME) names
      configured:
        !!(process.env.DATAFORSEO_LOGIN ?? process.env.DATAFORSEO_USERNAME) &&
        !!process.env.DATAFORSEO_PASSWORD,
      reachable: await pingHead("https://api.dataforseo.com"),
      detail: "Maps · SERP · Reviews · Lighthouse",
    },
    {
      name: "Meta Ad Library",
      category: "data",
      expects: "META_AD_LIBRARY_ACCESS_TOKEN",
      where: "third-party-account",
      configured: !!process.env.META_AD_LIBRARY_ACCESS_TOKEN,
      reachable: process.env.META_AD_LIBRARY_ACCESS_TOKEN
        ? await pingHead("https://graph.facebook.com")
        : null,
      detail: "ads_archive endpoint · needs Business Verification",
      optional: process.env.META_AD_LIBRARY_ACCESS_TOKEN
        ? undefined
        : {
            phase: "Phase 2",
            reason: "Required for daily ads scan cron. Phase 1 doesn't use it.",
          },
    },
    {
      name: "Stripe",
      category: "billing",
      expects: "STRIPE_SECRET_KEY",
      where: "third-party-account",
      configured: !!process.env.STRIPE_SECRET_KEY,
      reachable: await pingHead("https://api.stripe.com"),
      detail: "subscriptions + webhooks",
    },
    {
      name: "Resend",
      category: "comms",
      expects: "RESEND_API_KEY",
      where: "vercel-env",
      configured: !!process.env.RESEND_API_KEY,
      reachable: await pingHead("https://api.resend.com"),
      detail: "magic links + transactional",
    },
    {
      name: "Sentry",
      category: "observability",
      expects: "SENTRY_DSN",
      where: "vercel-env",
      configured: !!process.env.SENTRY_DSN,
      reachable: null,
      detail: process.env.SENTRY_DSN ? "DSN set" : "DSN missing",
      optional: process.env.SENTRY_DSN
        ? undefined
        : {
            phase: "Phase 8",
            reason: "Production error tracking. Optional during Phase 1 dev.",
          },
    },
    {
      name: "GA4",
      category: "observability",
      expects: "GA4_PROPERTY_ID + GOOGLE_APPLICATION_CREDENTIALS",
      where: "third-party-account",
      configured:
        !!process.env.GA4_PROPERTY_ID &&
        !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
      reachable: await pingHead("https://analyticsdata.googleapis.com"),
      detail: "user behavior + funnel attribution",
    },
    {
      name: "Google Search Console",
      category: "observability",
      expects: "GOOGLE_APPLICATION_CREDENTIALS",
      where: "third-party-account",
      configured: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
      reachable: await pingHead("https://searchconsole.googleapis.com"),
      detail: "indexing · clicks · impressions per query",
    },
    {
      name: "Apify",
      category: "data",
      expects: "APIFY_TOKEN",
      where: "third-party-account",
      configured: !!process.env.APIFY_TOKEN,
      reachable: process.env.APIFY_TOKEN
        ? await pingHead("https://api.apify.com")
        : null,
      detail: "Reddit + scraping (Phase 2 roadmap)",
      optional: process.env.APIFY_TOKEN
        ? undefined
        : { phase: "Phase 2", reason: "Reddit signal collection, not Phase 1" },
    },
    {
      name: "Redis / KV",
      category: "core",
      expects: "KV_REST_API_URL | REDIS_URL | UPSTASH_REDIS_REST_URL",
      where: "vercel-storage",
      configured: !!(
        process.env.KV_REST_API_URL ??
        process.env.REDIS_URL ??
        process.env.UPSTASH_REDIS_REST_URL
      ),
      reachable: null,
      detail:
        (process.env.KV_REST_API_URL ??
        process.env.REDIS_URL ??
        process.env.UPSTASH_REDIS_REST_URL)
          ? "rate limit + adapter caches ready"
          : "Vercel Storage → Redis (or Upstash) — auto-injects env vars",
      optional: {
        phase: "Phase 2",
        reason:
          "Only needed once crons start running (DataForSEO dedup cache) and user-facing API routes ship (rate limiting). Phase 1 doesn't use it.",
      },
    },
    {
      name: "Vercel Blob",
      category: "core",
      expects: "BLOB_READ_WRITE_TOKEN",
      where: "vercel-storage",
      configured: !!process.env.BLOB_READ_WRITE_TOKEN,
      reachable: null,
      detail: process.env.BLOB_READ_WRITE_TOKEN
        ? "PDF + CSV exports ready"
        : "create at vercel.com/home → Storage → Blob",
    },
  ];
}
