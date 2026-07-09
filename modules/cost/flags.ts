// modules/cost/flags.ts · runtime flags for the cost/billing engine.
//
// Read env INSIDE the function (never at module scope) so Vercel's build phase
// doesn't evaluate it with empty envs (INC-07). Default OFF everywhere — the
// entitlement billing decouple (Phase 2+) ships DARK until this is set to "1"
// AND the Neon migration has been deployed AND the shadow-run has passed.

/**
 * Whether the per-agency entitlement billing model is live. When OFF (default),
 * billing stays on the legacy global-freshness path — the entitlement ledger,
 * the four-quadrant fan-out, and the read/filter gates all no-op.
 */
export function entitlementBillingEnabled(): boolean {
  return process.env.ENTITLEMENT_BILLING === "1";
}
