// WP8-2 · rate-limit wrap on mutating agency server actions.
//
// Verifies the rate-limit short-circuit: when the shared `rateLimitAction`
// helper reports the caller is over quota, the action returns the standard
// `{ status: "rate_limited", retryAfter }` shape BEFORE touching validation,
// the DB, or spend. Mocks `@/lib/auth` (session) + `@/lib/middleware/rate-limit`
// (the limiter verdict). `setLeadStatusAction` is the representative action;
// every WP8-2 action follows the identical guard.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ─── Mockable session ───────────────────────────────────────────────────────

let SESSION: { user?: { id?: string } } | null = { user: { id: "user-1" } };

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => SESSION),
}));

// ─── Mockable rate-limit verdict ────────────────────────────────────────────

let LIMITED = false;

vi.mock("@/lib/middleware/rate-limit", () => ({
  // Real profiles are plain objects — the mock doesn't care about their shape.
  ACTION_MUTATE_LIMIT: { name: "action-mutate" },
  ACTION_ENQUEUE_LIMIT: { name: "action-enqueue" },
  rateLimitAction: vi.fn(async () =>
    LIMITED ? { limited: true, retryAfter: 42 } : { limited: false },
  ),
}));

// Prisma is imported by the action module but must never be reached when the
// rate limit trips (the guard runs first). Mock it defensively so an accidental
// DB hit throws loudly instead of silently passing.
vi.mock("@/lib/prisma", () => {
  const boom = () => {
    throw new Error("DB must not be touched when rate-limited");
  };
  return {
    default: new Proxy({}, { get: () => boom }),
    Prisma: {},
  };
});

vi.mock("@/lib/analytics/product-events", () => ({
  trackProductEvent: vi.fn(async () => undefined),
}));

// Import AFTER the mocks are registered.
import { setLeadStatusAction } from "../save-list-actions";

describe("WP8-2 · rate-limit on mutating agency actions", () => {
  beforeEach(() => {
    SESSION = { user: { id: "user-1" } };
    LIMITED = false;
  });
  afterEach(() => vi.clearAllMocks());

  test("returns rate_limited with retryAfter when over quota", async () => {
    LIMITED = true;
    const res = await setLeadStatusAction({
      leadId: "lead-1",
      status: "CONTACTED",
    });
    expect(res.status).toBe("rate_limited");
    if (res.status === "rate_limited") {
      expect(res.retryAfter).toBe(42);
    }
  });

  test("the rate-limit guard fires before input validation", async () => {
    // Deliberately invalid input — if the guard did NOT run first we'd get
    // `invalid_input`, not `rate_limited`. Proves ordering (no DB / no Zod work
    // happens for a throttled caller).
    LIMITED = true;
    const res = await setLeadStatusAction({ nonsense: true });
    expect(res.status).toBe("rate_limited");
  });

  test("unauthenticated callers are rejected before the rate-limit check", async () => {
    SESSION = null;
    LIMITED = true; // even when limited, auth wins (no key to bucket on)
    const res = await setLeadStatusAction({
      leadId: "lead-1",
      status: "CONTACTED",
    });
    expect(res.status).toBe("unauthorized");
  });

  test("does not short-circuit when under quota (reaches validation)", async () => {
    LIMITED = false;
    // Invalid input now surfaces as invalid_input — proving the guard passed
    // through and the action proceeded to Zod. (We stop at validation so the
    // mocked-throwing prisma is never reached.)
    const res = await setLeadStatusAction({ nonsense: true });
    expect(res.status).toBe("invalid_input");
  });
});
