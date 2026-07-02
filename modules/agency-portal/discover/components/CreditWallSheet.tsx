"use client";

// CreditWallSheet · the contextual upgrade sheet at the credit wall (WP2-3).
//
// Replaces the old dead-end "Not enough credits — add credits" toast: when a
// quote exceeds the wallet, the buyer stays IN the Preview context and gets
// every path forward on one small inline sheet:
//
//   1. Enrich your best N within the current balance (the WP2-2 top-N path) —
//      first value now, $0.
//   2. The two top-up packs — direct Stripe checkout via the existing
//      `startTopUpCheckout` server action (form post; degrades to the billing
//      page with `?billing_error=unconfigured` when the price id is unset).
//   3. The next plan up — deep link to /team/billing?deficit=X (plan checkout
//      needs the OWNER/ADMIN role gate + the full plan grid, so the sheet
//      links rather than posts; the billing page reads `deficit` and frames
//      the top-up section around it).
//
// Plan suggestion (Tom-persona decision): the CHEAPEST paid card whose monthly
// grant covers this run — numbers over adjectives, no "recommended for you"
// fluff. Copy is English-only, jargon-OK, per .claude/rules/ui-ux-agency.md.

import { Link } from "@/i18n/navigation";

import { startTopUpCheckout } from "@/modules/billing/credit-checkout";
import {
  PLAN_CARDS,
  PLAN_CARD_ORDER,
  TOPUP_PACKS,
  type PlanKey,
} from "@/modules/cost/pricing";
import { fmtCredits } from "../flow-types";

export interface CreditWallSheetProps {
  /** Credits the attempted run needs (server quote when available). */
  needCredits: number;
  /** Current wallet balance in credits. */
  walletCredits: number;
  /** Locale for the checkout return URL (same contract as TopUpPacks). */
  locale: string;
  /**
   * The wallet-capped fallback: enrich the best N now for `credits`. Null when
   * the balance can't cover even one lead (then only buying paths render).
   */
  affordable: { n: number; of: number; credits: number } | null;
  /** Apply the top-N fallback (sets the lead-count control + closes the sheet). */
  onPickTopN: (n: number) => void;
  onClose: () => void;
}

/** Cheapest paid plan whose monthly grant covers the run; Scale as the cap. */
function suggestedPlan(needCredits: number): PlanKey {
  for (const key of PLAN_CARD_ORDER) {
    const card = PLAN_CARDS[key];
    if (card.priceUsd > 0 && card.monthlyCredits >= needCredits) return key;
  }
  return "scale";
}

export function CreditWallSheet({
  needCredits,
  walletCredits,
  locale,
  affordable,
  onPickTopN,
  onClose,
}: CreditWallSheetProps) {
  const deficit = Math.max(0, needCredits - walletCredits);
  const plan = PLAN_CARDS[suggestedPlan(needCredits)];

  return (
    <div className="card section" role="region" aria-label="Add credits">
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <h2 style={{ margin: 0 }}>
          This run needs ~{fmtCredits(needCredits)} credits — you have{" "}
          {fmtCredits(walletCredits)}.
        </h2>
        <button
          type="button"
          className="btn sm"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <p className="note" style={{ margin: "4px 0 12px" }}>
        {fmtCredits(deficit)} credits short. Three ways forward — nothing is
        charged until you confirm a run.
      </p>

      {affordable && affordable.n > 0 ? (
        <div
          className="callout"
          style={{ marginBottom: 12, alignItems: "center" }}
        >
          <span aria-hidden="true">⚡</span>
          <div style={{ flex: 1 }}>
            <b>
              Or enrich your best {affordable.n.toLocaleString()} of{" "}
              {affordable.of.toLocaleString()} within your credits
            </b>{" "}
            <span className="note">
              · ~{fmtCredits(affordable.credits)} credits · ranked by review
              count
            </span>
          </div>
          <button
            type="button"
            className="btn primary sm"
            onClick={() => onPickTopN(affordable.n)}
          >
            Enrich best {affordable.n.toLocaleString()} →
          </button>
        </div>
      ) : null}

      <div
        className="grid"
        style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}
      >
        {TOPUP_PACKS.map((pack) => (
          <div className="card" key={pack.key} style={{ margin: 0 }}>
            <div className="eyebrow">Top-up · one-time</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
              +{fmtCredits(pack.credits)} credits
            </div>
            <div className="note" style={{ margin: "2px 0 10px" }}>
              ${pack.priceUsd} · {pack.rate} · never expires
            </div>
            <form action={startTopUpCheckout} style={{ margin: 0 }}>
              <input type="hidden" name="pack" value={pack.key} />
              <input type="hidden" name="locale" value={locale} />
              <button
                type="submit"
                className={pack.primary ? "btn primary sm" : "btn sm"}
              >
                Buy +{fmtCredits(pack.credits)} · ${pack.priceUsd}
              </button>
            </form>
          </div>
        ))}

        <div className="card" style={{ margin: 0 }}>
          <div className="eyebrow">
            Plan · monthly{plan.featured ? " · best value" : ""}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
            {plan.displayName} · ${plan.priceUsd}/mo
          </div>
          <div className="note" style={{ margin: "2px 0 10px" }}>
            {fmtCredits(plan.monthlyCredits)} credits/mo · {plan.rate}
          </div>
          <Link
            href={{
              pathname: "/team/billing",
              query: { deficit: String(deficit) },
            }}
            className="btn sm"
          >
            See plans →
          </Link>
        </div>
      </div>

      <p className="note" style={{ margin: "10px 0 0" }}>
        <Link
          href={{
            pathname: "/team/billing",
            query: { deficit: String(deficit) },
          }}
        >
          Open billing & credits →
        </Link>
      </p>
    </div>
  );
}
