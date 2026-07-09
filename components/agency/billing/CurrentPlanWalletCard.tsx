/**
 * Current-plan + wallet card — SLIMMED 2026-07-09 (Part D, docs/billing-
 * repricing). Collapsed from the tall multi-tile card to a one-row summary
 * (plan · balance · renews · thin usage bar) so the plans grid sits above the
 * fold. Also hosts the native Cancel/Resume control (F-6) via the
 * `setPlanCancellation` server action — no bounce to the Stripe portal.
 *
 * Server-presentational: the Cancel/Resume CTA is a server-action `<form>`, so
 * nothing crosses a `'use client'` boundary.
 */

import { setPlanCancellation } from "@/modules/billing/credit-checkout";
import { CREDIT_MEANING } from "@/modules/cost/pricing";

import { CoinGlyph } from "./CoinGlyph";

export interface CurrentPlanWalletProps {
  /** Display name of the active plan (Free / Starter / Solo / Growth / Pro). */
  planName: string;
  /** Whether the active plan is the featured / best-value tier. */
  featured: boolean;
  /** Monthly (or one-time, for Free) credit allowance for the active plan. */
  monthlyCredits: number;
  /** True when the active plan's grant is one-time (Free) not recurring. */
  oneTime: boolean;
  /** Renewal date, already formatted (e.g. "Jul 1"); null when none. */
  renewsLabel: string | null;
  /** Plan-bucket balance (planCredits — resets on renewal). */
  planBalance: number;
  /** Purchased / top-up balance (never expires). */
  topUpBalance: number;
  /** Available = plan + top-up − held (the spendable number). */
  availableBalance: number;
  /** Credits reserved by an in-flight run (subtracted from available). */
  heldCredits: number;
  /** Locale for the cancel/resume action's return URL. */
  locale: string;
  /** True when there's a live paid subscription (cancel/resume applies). */
  subActive: boolean;
  /** True when the subscription is already set to cancel at period end. */
  cancelAtPeriodEnd: boolean;
  /** True when the viewer can manage billing (OWNER/ADMIN) — gates the CTA. */
  canManage: boolean;
}

const nf = new Intl.NumberFormat("en-US");

export function CurrentPlanWalletCard({
  planName,
  featured,
  monthlyCredits,
  oneTime,
  renewsLabel,
  planBalance,
  topUpBalance,
  availableBalance,
  heldCredits,
  locale,
  subActive,
  cancelAtPeriodEnd,
  canManage,
}: CurrentPlanWalletProps) {
  // Cycle math: how much of this cycle's allowance is spent.
  const left = Math.min(planBalance, monthlyCredits);
  const used = Math.max(0, monthlyCredits - left);
  const pctUsed =
    monthlyCredits > 0 ? Math.round((used / monthlyCredits) * 100) : 0;

  const fullyEnriched = Math.floor(
    availableBalance / CREDIT_MEANING.fullEnrichment,
  );

  const renewsSuffix =
    !oneTime && renewsLabel
      ? cancelAtPeriodEnd
        ? ` · ends ${renewsLabel}`
        : ` · renews ${renewsLabel}`
      : "";

  return (
    <div className="card" style={{ marginTop: 4 }}>
      {/* Row 1 · plan · balance · renews */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span className="eyebrow">Current plan</span>
          <span style={{ fontSize: 18, fontWeight: 750 }}>{planName}</span>
          {featured ? (
            <span className="pill indigo dot">Best value</span>
          ) : null}
          {cancelAtPeriodEnd ? (
            <span className="pill amber dot">
              Cancels{renewsLabel ? ` ${renewsLabel}` : ""}
            </span>
          ) : null}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700 }}>
            <span className="cr">
              <CoinGlyph sm />
              {nf.format(availableBalance)}
            </span>{" "}
            available
          </div>
          <div className="note" style={{ fontSize: 11.5 }}>
            {nf.format(monthlyCredits)} credits
            {oneTime ? " · one-time" : " / mo"}
            {renewsSuffix}
          </div>
        </div>
      </div>

      {/* Row 2 · thin usage bar */}
      <div className="bar" style={{ marginTop: 12 }}>
        <i style={{ width: `${pctUsed}%` }} />
      </div>
      <div
        style={{
          marginTop: 6,
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span className="note" style={{ fontSize: 11.5 }}>
          {pctUsed}%{" "}
          {oneTime
            ? "of your free credits used"
            : "of this cycle used · plan credits reset on renewal"}{" "}
          · ≈ {nf.format(fullyEnriched)} fully enriched left
          {topUpBalance > 0
            ? ` · ${nf.format(topUpBalance)} top-up credits never expire`
            : ""}
          {heldCredits > 0
            ? ` · ${nf.format(heldCredits)} held for a run in progress`
            : ""}
        </span>
        {subActive && canManage ? (
          <form action={setPlanCancellation} style={{ margin: 0 }}>
            <input type="hidden" name="locale" value={locale} />
            <input
              type="hidden"
              name="cancel"
              value={cancelAtPeriodEnd ? "false" : "true"}
            />
            <button
              type="submit"
              className="linkbtn"
              style={{
                border: "none",
                background: "none",
                padding: 0,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                color: cancelAtPeriodEnd ? "var(--indigo)" : "var(--muted)",
              }}
            >
              {cancelAtPeriodEnd ? "Resume plan" : "Cancel plan"}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
