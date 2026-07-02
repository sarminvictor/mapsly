// Rate limiting middleware · per .claude/rules/scalability.md + security.md.
//
// Three default limit profiles, all sliding-window:
//
//   - PUBLIC_LIMIT   60 req/min  — marketing pages, public read APIs (key by IP)
//   - USER_LIMIT     30 req/min  — authenticated user-facing API (key by user.id)
//   - WEBHOOK_LIMIT 200 req/min  — Stripe / Resend webhooks (key by source)
//
// Cron handlers (`app/api/cron/*`) are NOT rate-limited — they're server-to-
// server, authenticated via CRON_SECRET, and gated by the cron schedule itself.
//
// Usage in a Route Handler:
//
//   import { rateLimit, USER_LIMIT, ipKey } from "@/lib/middleware/rate-limit";
//
//   export async function POST(req: Request) {
//     const session = await auth();
//     if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
//
//     const limited = await rateLimit(req, USER_LIMIT, session.user.id);
//     if (limited) return limited;
//
//     // ... handler body
//   }
//
// Or via the decorator:
//
//   export const POST = withRateLimit(PUBLIC_LIMIT, ipKey, async (req) => {
//     // ... handler body
//   });
//
// ─── Design notes ───────────────────────────────────────────────────────────
//
// Lazy instantiation. `@vercel/kv` reads env vars at module load time. If the
// KV binding isn't configured (local dev without KV, Vercel build phase, test
// envs), naive Ratelimit construction blows up at import. We defer Ratelimit
// construction until the first `rateLimit()` call and check `isKvAvailable()`
// from `@/lib/cache/kv` (which already handles the env-detection logic). This
// matches the INC-2026-05-19-07 pattern for Prisma / Stripe / Anthropic clients.
//
// Fail-soft. When KV is unavailable, `rateLimit` returns `null` (allow) and
// logs a warning. Production has KV bound; local dev / build / tests don't.
// Refusing to serve any request because KV is missing would break those
// environments — we'd rather log a warning than fight that battle.
//
// 429 response shape. Standard `Retry-After` header (in seconds) + the
// `X-RateLimit-{Limit,Remaining,Reset}` triplet that monitoring tools expect.
// Body matches `.claude/rules/validation-and-errors.md` standard error shape:
// `{ error: "rate_limited", retryAfter, limit, remaining }`.

import { Ratelimit } from "@upstash/ratelimit";
import { kv as vercelKv } from "@vercel/kv";

import { isKvAvailable } from "@/lib/cache/kv";

// ─── Limit profile registry ─────────────────────────────────────────────────

/**
 * A rate-limit profile combines a sliding-window throughput cap with a prefix
 * that isolates this limiter's keyspace from others sharing the same KV.
 */
export interface LimitProfile {
  readonly name: string;
  readonly limit: number;
  readonly window: `${number} ${"s" | "m" | "h"}`;
  readonly prefix: string;
}

/** Public/anonymous routes — 60 req/min/IP. */
export const PUBLIC_LIMIT: LimitProfile = {
  name: "public",
  limit: 60,
  window: "1 m",
  prefix: "rl:public",
};

/** Authenticated user-facing API — 30 req/min/user. */
export const USER_LIMIT: LimitProfile = {
  name: "user",
  limit: 30,
  window: "1 m",
  prefix: "rl:user",
};

/** Webhook handlers (Stripe, Resend) — 200 req/min/source. */
export const WEBHOOK_LIMIT: LimitProfile = {
  name: "webhook",
  limit: 200,
  window: "1 m",
  prefix: "rl:webhook",
};

/**
 * Visitor-facing transactional email (e.g. the free-report confirmation) —
 * 2 per hour PER RECIPIENT EMAIL. Bounds email-bombing of any one address and
 * protects sending reputation: the IP limit alone can't stop an attacker
 * rotating IPs to hammer a single victim, so this is keyed on the email.
 */
export const LEAD_EMAIL_LIMIT: LimitProfile = {
  name: "lead-email",
  limit: 2,
  window: "1 h",
  prefix: "rl:lead-email",
};

// Lazy limiter cache. Keyed by prefix so two profiles with the same prefix
// would share an instance (which is fine — they'd be misconfigured anyway).
const limiterCache = new Map<string, Ratelimit>();

function getLimiter(profile: LimitProfile): Ratelimit | null {
  if (!isKvAvailable()) return null;
  const existing = limiterCache.get(profile.prefix);
  if (existing) return existing;

  // `@vercel/kv` exposes an Upstash-Redis-compatible client. The Ratelimit
  // constructor wants the canonical `Redis` type from `@upstash/redis`; the
  // two are structurally compatible. Cast through unknown to avoid pulling
  // `@upstash/redis` types into this module's surface.
  const limiter = new Ratelimit({
    redis: vercelKv as unknown as ConstructorParameters<
      typeof Ratelimit
    >[0]["redis"],
    limiter: Ratelimit.slidingWindow(profile.limit, profile.window),
    prefix: profile.prefix,
    analytics: false,
  });
  limiterCache.set(profile.prefix, limiter);
  return limiter;
}

// ─── Key extraction helpers ─────────────────────────────────────────────────

/**
 * Extract a stable IP key from a Request. Prefers `x-forwarded-for` (Vercel
 * sets this on every edge request), falls back to `x-real-ip`, then to a
 * literal sentinel so the limiter always has a non-empty bucket key.
 *
 * IMPORTANT: this is for rate-limit keying only — do NOT use the returned
 * value for logging or persistence without further validation. The header
 * is client-controllable in non-Vercel deployments.
 */
export function ipKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // First entry is the original client; later entries are proxy hops.
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "ip:unknown";
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Apply a rate limit to the current request.
 *
 * Returns `null` if the request is allowed (within the per-window quota OR
 * KV is not configured in the current process — fail-soft path).
 *
 * Returns a 429 `Response` if the limit was exceeded. The Response carries
 * `Retry-After` (seconds) and `X-RateLimit-{Limit,Remaining,Reset}` headers,
 * with a JSON body `{ error: "rate_limited", retryAfter, limit, remaining }`.
 */
export async function rateLimit(
  _req: Request, // currently unused — reserved for future per-request tagging
  profile: LimitProfile,
  key: string,
): Promise<Response | null> {
  const limiter = getLimiter(profile);
  if (!limiter) {
    // KV unavailable — fail-soft. Production always has KV bound; local dev,
    // build phase, and tests don't. Logging keeps the path observable so a
    // missing prod binding shows up in Sentry without breaking the request.
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "rate_limit.kv_unavailable",
        profile: profile.name,
      }),
    );
    return null;
  }

  let r: Awaited<ReturnType<Ratelimit["limit"]>>;
  try {
    r = await limiter.limit(key);
  } catch (err) {
    // The reachability check passed but the limiter call itself threw — the
    // `@vercel/kv` client demands KV_REST_API_URL/TOKEN at call time (config
    // mismatch), or Upstash is down / unreachable. Honor the module's
    // documented fail-soft contract: ALLOW the request rather than 500 every
    // caller (incl. the Stripe webhook). Production surfaces it via this log.
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "rate_limit.limiter_failed",
        profile: profile.name,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
  if (r.success) return null;

  const retryAfterSec = Math.max(0, Math.ceil((r.reset - Date.now()) / 1000));
  return Response.json(
    {
      error: "rate_limited",
      retryAfter: retryAfterSec,
      limit: r.limit,
      remaining: r.remaining,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Limit": String(r.limit),
        "X-RateLimit-Remaining": String(r.remaining),
        "X-RateLimit-Reset": String(r.reset),
      },
    },
  );
}

// ─── Server-action limiter (WP8-2) ───────────────────────────────────────────

/** Outcome of an action-level rate-limit check. */
export type ActionRateLimit =
  | { limited: false }
  | { limited: true; retryAfter: number };

/**
 * Rate-limit a Server Action. Unlike Route Handlers, `'use server'` functions
 * receive no `Request`, so there's no `Response` to return and `ipKey()` can't
 * read headers off an argument. This variant takes just a profile + a key
 * (typically `session.user.id` with `USER_LIMIT`) and returns a plain result
 * the action maps to its own error shape (e.g. `{ status: "rate_limited" }`).
 *
 * Fail-soft, exactly like `rateLimit`: when KV is unavailable or the limiter
 * throws, this returns `{ limited: false }` (allow) and logs — never blocks a
 * mutation because the limiter is down.
 */
export async function rateLimitAction(
  profile: LimitProfile,
  key: string,
): Promise<ActionRateLimit> {
  const limiter = getLimiter(profile);
  if (!limiter) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "rate_limit.kv_unavailable",
        profile: profile.name,
      }),
    );
    return { limited: false };
  }

  let r: Awaited<ReturnType<Ratelimit["limit"]>>;
  try {
    r = await limiter.limit(key);
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "rate_limit.limiter_failed",
        profile: profile.name,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { limited: false };
  }
  if (r.success) return { limited: false };

  const retryAfter = Math.max(0, Math.ceil((r.reset - Date.now()) / 1000));
  return { limited: true, retryAfter };
}

// ─── Action-limit profiles (WP8-2) ────────────────────────────────────────────

/**
 * Enqueue/estimate-class actions (enrichment run, discovery, touch generation,
 * top-up checkout start). These are heavier + spend-bearing, so they get a
 * TIGHTER window than plain UI mutations — a flood of enqueue calls costs money
 * and DB work, not just a status flip. 10 / min / user.
 */
export const ACTION_ENQUEUE_LIMIT: LimitProfile = {
  name: "action-enqueue",
  limit: 10,
  window: "1 m",
  prefix: "rl:act-enqueue",
};

/**
 * Cheap UI mutations (lead status changes, template save, dispute reports,
 * invites, draft polish). Bounded generously — a triage sweep is legitimately
 * bursty — but still capped so a runaway client/script can't hammer the DB.
 * 40 / min / user.
 */
export const ACTION_MUTATE_LIMIT: LimitProfile = {
  name: "action-mutate",
  limit: 40,
  window: "1 m",
  prefix: "rl:act-mutate",
};

/**
 * WP7-5 · enrich-RUN creation cap keyed by IP (in addition to the per-user
 * ACTION_ENQUEUE_LIMIT). Trial-abuse farming rotates ACCOUNTS behind one IP to
 * spend many free grants; a per-IP window bounds that vector independently of
 * the user key. Generous enough for a real multi-seat agency on one office IP
 * (a team rarely starts > 20 runs/min collectively), tight enough to blunt
 * scripted farming. Read the IP via `headers()` in the server action.
 */
export const ENRICH_RUN_IP_LIMIT: LimitProfile = {
  name: "enrich-run-ip",
  limit: 20,
  window: "1 m",
  prefix: "rl:enrich-ip",
};

// ─── Per-route decorator ────────────────────────────────────────────────────

type Handler = (req: Request) => Promise<Response> | Response;

/**
 * Per-route helper that wraps a Route Handler with a rate limit.
 *
 * `keyFn` builds the per-request bucket key. Use `ipKey` for public routes,
 * a session-derived function (`(req) => session.user.id`) for authenticated
 * routes, or a webhook-source extractor for webhook handlers.
 *
 *   export const POST = withRateLimit(PUBLIC_LIMIT, ipKey, async (req) => {
 *     // ... handler body
 *   });
 */
export function withRateLimit(
  profile: LimitProfile,
  keyFn: (req: Request) => string | Promise<string>,
  handler: Handler,
): Handler {
  return async function rateLimitedHandler(req: Request): Promise<Response> {
    const key = await keyFn(req);
    const limited = await rateLimit(req, profile, key);
    if (limited) return limited;
    return handler(req);
  };
}

// ─── Test-only helpers ──────────────────────────────────────────────────────

/**
 * TEST ONLY · clears the lazy limiter cache so a test can swap KV mocks or
 * env vars between cases without inheriting stale Ratelimit instances.
 * Production code paths never call this.
 */
export function __resetLimitersForTest(): void {
  limiterCache.clear();
}
