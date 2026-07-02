// lib/analytics/product-events.ts · server-side product analytics (WP2-1,
// the WP6-4 foundation). One tiny helper over the ProductEvent table (WP0-8)
// — no external vendor, no client bundle impact (server modules only; it
// imports `@/lib/prisma`, which is server-only by construction).
//
// Contract:
//   - Fire-and-forget: NEVER throws and never blocks the caller's happy path.
//     Callers may `void trackProductEvent(...)` (preferred) or await it.
//   - Writes one append-only ProductEvent row `{ type, agencyId?, userId?,
//     propsJson }` — indexed on (type, createdAt) + (agencyId, createdAt) for
//     the activation-funnel queries WP6-4 adds.
//   - No PII in `props`: ids and counts only (per .claude/rules/observability.md
//     — emails/phones never land in analytics rows).

import prisma, { Prisma } from "@/lib/prisma";

/**
 * Known event types. A plain string union (not an enum) so call sites stay
 * greppable while new events can be added without a migration — the column is
 * a free-form string by design (WP0-8).
 */
export type ProductEventType =
  | "agency_created"
  // ── WP7-5 · trial-abuse: a disposable-email signup refused provisioning ──
  | "agency_provision_blocked"
  // ── WP6-4 · the ~10 activation checkpoints (server-side, funnel-ordered) ──
  | "signup"
  | "goal_selected"
  | "market_mapped"
  | "preview_viewed"
  | "discovery_started"
  | "enrich_started"
  | "enrich_completed"
  | "first_lead_drawer_opened"
  | "touch_generated"
  | "csv_exported"
  | "credit_exhausted_hit"
  // ── retained legacy alias (WP2 shipped this name; keep it valid) ──
  | "credit_wall_hit"
  // ── WP6-13 · per-source data-quality feedback signal ──
  | "data_disputed"
  // ── WP7-3 · a disputed playbook FINDING (expert flag), hidden from artifacts ──
  | "finding_disputed"
  // ── WP7-13 · a taxonomy-miss capture — user requested a category we don't carry ──
  | "category_requested"
  // ── WP6-14 · outcome feedback (lead status transitions) ──
  | "status_changed"
  // ── WP6-12 · "why now" timing signal surfaced by the market monitor ──
  | "market_signal"
  // ── WP6-10 · agency-branded viral one-pager share funnel ──
  | "audit_shared"
  | "audit_link_viewed";

export interface TrackProductEventInput {
  type: ProductEventType;
  agencyId?: string | null;
  userId?: string | null;
  /** Plain JSON facts (ids/counts only — never PII). */
  props?: Record<string, unknown>;
}

/**
 * Record one product event. Fire-and-forget: any failure is logged (single-line
 * JSON per observability rule) and swallowed — analytics must never break a
 * user-facing action.
 */
export async function trackProductEvent(
  input: TrackProductEventInput,
): Promise<void> {
  try {
    await prisma.productEvent.create({
      data: {
        type: input.type,
        agencyId: input.agencyId ?? null,
        userId: input.userId ?? null,
        propsJson: (input.props ?? undefined) as
          | Prisma.InputJsonObject
          | undefined,
      },
      select: { id: true },
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "warn",
        event: "product_event.write_failed",
        type: input.type,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
