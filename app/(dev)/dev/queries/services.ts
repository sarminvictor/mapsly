// Service health: env-var presence + connectivity pings to external dependencies.
// Distinct from the "MCP" health check — MCPs are stdio processes that only
// live inside Claude's runtime. From a deployed Next.js app we can only check
// the underlying APIs the app depends on at runtime.

import { cacheLife, cacheTag } from "next/cache";

export interface ServiceStatus {
  name: string;
  category: "core" | "ai" | "data" | "billing" | "comms" | "observability";
  configured: boolean;
  reachable: boolean | null; // null = not yet pinged
  detail: string;
}

async function pingHead(url: string, ms = 4000): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    clearTimeout(timer);
    // Any 2xx/3xx/4xx means the host is up; 4xx is fine (auth missing is expected)
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function getServiceHealth(): Promise<ServiceStatus[]> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-services");

  const dbUrl = process.env.DATABASE_URL;
  const dbHost = dbUrl
    ? new URL(dbUrl.replace(/^postgresql/, "https")).host
    : null;

  const results: ServiceStatus[] = [
    {
      name: "Neon Postgres",
      category: "core",
      configured: !!dbUrl,
      reachable: dbHost ? await pingHead(`https://${dbHost}`) : null,
      detail: dbHost ?? "DATABASE_URL not set",
    },
    {
      name: "GitHub API",
      category: "core",
      configured: !!process.env.GITHUB_TOKEN,
      reachable: await pingHead("https://api.github.com"),
      detail: "REST + Contents API",
    },
    {
      name: "Anthropic",
      category: "ai",
      configured: !!process.env.ANTHROPIC_API_KEY,
      reachable: await pingHead("https://api.anthropic.com"),
      detail: "review sentiment, reply drafts, copy",
    },
    {
      name: "DataForSEO",
      category: "data",
      configured:
        !!process.env.DATAFORSEO_USERNAME && !!process.env.DATAFORSEO_PASSWORD,
      reachable: await pingHead("https://api.dataforseo.com"),
      detail: "Maps · SERP · Reviews · Lighthouse",
    },
    {
      name: "Meta Ad Library",
      category: "data",
      configured: !!process.env.META_AD_LIBRARY_ACCESS_TOKEN,
      reachable: await pingHead("https://graph.facebook.com"),
      detail: "ads_archive endpoint",
    },
    {
      name: "Stripe",
      category: "billing",
      configured: !!process.env.STRIPE_SECRET_KEY,
      reachable: await pingHead("https://api.stripe.com"),
      detail: "subscriptions + webhooks",
    },
    {
      name: "Resend",
      category: "comms",
      configured: !!process.env.RESEND_API_KEY,
      reachable: await pingHead("https://api.resend.com"),
      detail: "magic links + transactional",
    },
    {
      name: "Sentry",
      category: "observability",
      configured: !!process.env.SENTRY_DSN,
      reachable: null,
      detail: process.env.SENTRY_DSN ? "DSN set" : "DSN missing",
    },
    {
      name: "Vercel KV",
      category: "core",
      configured: !!process.env.KV_REST_API_URL,
      reachable: null,
      detail: "rate limit + adapter caches",
    },
    {
      name: "Vercel Blob",
      category: "core",
      configured: !!process.env.BLOB_READ_WRITE_TOKEN,
      reachable: null,
      detail: "PDF + CSV exports",
    },
  ];

  return results;
}
