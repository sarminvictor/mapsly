/**
 * Current-plan + wallet card (prototype #view-billing lines 7981–8047).
 *
 * Renders the active plan name + "Best value" pill (featured tiers only), the
 * "N credits / mo · renews {date}" note, the cycle usage bar, and the two
 * balance tiles (Plan balance + Top-up balance) with their yield translations,
 * plus the 🔒 server-enforced lock callout.
 *
 * Server-presentational: every prop is plain serialized data (no functions
 * cross a `'use client'` boundary — this component is rendered on the server
 * and emits static markup).
 */

import { CREDIT_MEANING } from "@/modules/cost/pricing";

import { CoinGlyph } from "./CoinGlyph";

export interface CurrentPlanWalletProps {
  /** Display name of the active plan (Free / Starter / Growth / Scale). */
  planName: string;
  /** Whether the active plan is the featured / best-value tier. */
  featured: boolean;
  /** Monthly (or one-time, for Free) credit allowance for the active plan. */
  monthlyCredits: number;
  /** True when the active plan's grant is one-time (Free) not recurring. */
  oneTime: boolean;
  /** Renewal date, already formatted (e.g. "Jul 1"); null when none. */
  renewsLabel: string | null;
  /** Plan-bucket balance (planCredits + rolloverCredits — the resets-on-renewal pool). */
  planBalance: number;
  /** Purchased / top-up balance (never expires). */
  topUpBalance: number;
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
}: CurrentPlanWalletProps) {
  // Cycle math: how much of this cycle's allowance is spent. We treat the
  // current plan balance (plan + rollover) as "left" against the monthly
  // allowance. Clamp so a rollover-heavy wallet never shows negative usage.
  const left = Math.min(planBalance, monthlyCredits);
  const used = Math.max(0, monthlyCredits - left);
  const pctUsed =
    monthlyCredits > 0 ? Math.round((used / monthlyCredits) * 100) : 0;

  // Yield translation for the plan-balance tile.
  const fullyEnriched = Math.floor(planBalance / CREDIT_MEANING.fullEnrichment);
  const contacts = planBalance; // 1 credit = 1 lead-with-contacts

  const creditsLine = oneTime
    ? `${nf.format(monthlyCredits)} credits · one-time`
    : `${nf.format(monthlyCredits)} credits / mo${
        renewsLabel ? ` · renews ${renewsLabel}` : ""
      }`;

  return (
    <div className="card" style={{ marginTop: 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div className="eyebrow">Current plan</div>
          <div style={{ fontSize: 20, fontWeight: 750 }}>{planName}</div>
          <div className="note">{creditsLine}</div>
        </div>
        {featured ? <span className="pill indigo dot">Best value</span> : null}
      </div>

      <div
        style={{
          margin: "16px 0 6px",
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12.5,
          fontWeight: 600,
        }}
      >
        <span>
          {oneTime ? "Free credits" : "This cycle"}:{" "}
          <span className="cr">
            <CoinGlyph sm />
            {nf.format(used)} used
          </span>
        </span>
        <span className="note">
          {nf.format(left)} of {nf.format(monthlyCredits)} left
        </span>
      </div>
      <div className="bar">
        <i style={{ width: `${pctUsed}%` }} />
      </div>
      <div className="note" style={{ marginTop: 6 }}>
        {pctUsed}%{" "}
        {oneTime
          ? "of your free credits used. One-time — never reset"
          : "of this cycle used. Plan credits reset on renewal"}{" "}
        · top-ups never expire.
      </div>

      <div className="grid g2" style={{ marginTop: 16, gap: 10 }}>
        <div className="stat">
          <div className="k">Plan balance</div>
          <div className="v">
            <CoinGlyph />
            {nf.format(planBalance)}
          </div>
          <div className="d">
            ≈ {nf.format(fullyEnriched)} fully enriched · or{" "}
            {nf.format(contacts)} contacts
          </div>
        </div>
        <div className="stat">
          <div className="k">Top-up balance</div>
          <div className="v">
            <CoinGlyph />
            {nf.format(topUpBalance)}
          </div>
          <div className="d">never expires</div>
        </div>
      </div>

      <div className="callout" style={{ marginTop: 14 }}>
        <span aria-hidden="true">🔒</span>
        <p style={{ margin: 0 }}>
          A run your balance can&apos;t cover won&apos;t start —
          server-enforced. No surprise charges.
        </p>
      </div>
    </div>
  );
}
