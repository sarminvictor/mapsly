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
}

async function pingHead(url: string, ms = 4000): Promise<boolean> {
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
  cacheLife("seconds");
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
      name: "Anthropic",
      category: "ai",
      expects: "ANTHROPIC_API_KEY",
      where: "vercel-env",
      configured: !!process.env.ANTHROPIC_API_KEY,
      reachable: await pingHead("https://api.anthropic.com"),
      detail: "review sentiment · reply drafts · copy",
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
      reachable: await pingHead("https://graph.facebook.com"),
      detail: "ads_archive endpoint · needs Business Verification",
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
    },
    {
      name: "Vercel KV",
      category: "core",
      expects: "KV_REST_API_URL",
      where: "vercel-storage",
      configured: !!process.env.KV_REST_API_URL,
      reachable: null,
      detail: process.env.KV_REST_API_URL
        ? "rate limit + adapter caches ready"
        : "create at vercel.com/dashboard → Storage → KV",
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
        : "create at vercel.com/dashboard → Storage → Blob",
    },
  ];
}
