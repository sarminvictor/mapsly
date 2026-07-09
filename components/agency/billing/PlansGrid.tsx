/**
 * The plans grid — reworked 2026-07-09 (Part D, docs/billing-repricing).
 *
 * Layout: the four PAID cards (Starter / Solo · featured / Growth / Pro) fill
 * the 4-col `.plans` grid above the fold; the FREE plan renders as a single
 * de-emphasized horizontal strip at the bottom (it sells contacts, not
 * enrichment — C2). Each paid card shows ONE primary yield figure ("N delivered
 * leads / mo") instead of the old confusing dual number.
 *
 * CTA behaviour (Part E · avoid the double-subscription bug):
 *   - The ACTIVE plan renders a disabled "Current plan" button.
 *   - An agency with NO active subscription → `startPlanCheckout` (a NEW
 *     subscription). A paid plan whose price id isn't configured yet renders a
 *     disabled "Choose {plan}" with a tip (graceful degradation).
 *   - An agency WITH an active subscription → the CTA routes to the Stripe
 *     Customer Portal (`openBillingPortal`) to CHANGE tier, never a fresh
 *     checkout — otherwise a second subscription is created. Labelled
 *     "Upgrade to {plan}" / "Switch to {plan}" by direction; the featured
 *     ribbon + filled emphasis are suppressed on tiers BELOW the active one so a
 *     downgrade is never the loudest button.
 *
 * Server-presentational: every CTA is a server-action `<form>`, so nothing
 * crosses a `'use client'` boundary.
 */

import { openBillingPortal } from "@/modules/billing/actions";
import { startPlanCheckout } from "@/modules/billing/credit-checkout";
import {
  PLAN_CARDS,
  PLAN_CARD_ORDER,
  type PlanCard,
  type PlanKey,
} from "@/modules/cost/pricing";

import { CoinGlyph } from "./CoinGlyph";

const nf = new Intl.NumberFormat("en-US");

export interface PlansGridProps {
  /** The agency's currently active display plan. */
  activePlan: PlanKey;
  /** Per-paid-plan flag: is its Stripe price id configured? */
  configured: Record<Exclude<PlanKey, "free">, boolean>;
  /** Locale (passed into the checkout action for the return URL). */
  locale: string;
  /** True when the agency has a live paid subscription — switches route to the
   *  Stripe portal instead of a fresh checkout (avoids a 2nd subscription). */
  subActive: boolean;
  /** Absolute return URL for the Stripe portal (plan-switch path). */
  portalReturnUrl: string;
}

export function PlansGrid({
  activePlan,
  configured,
  locale,
  subActive,
  portalReturnUrl,
}: PlansGridProps) {
  const paidKeys = PLAN_CARD_ORDER.filter(
    (k): k is Exclude<PlanKey, "free"> => k !== "free",
  );
  const activeIdx = PLAN_CARD_ORDER.indexOf(activePlan);
  return (
    <>
      <div className="eyebrow" style={{ margin: "26px 0 10px" }}>
        Plans
      </div>
      <div className="plans">
        {paidKeys.map((key) => (
          <PlanCardView
            key={key}
            card={PLAN_CARDS[key]}
            active={key === activePlan}
            configured={configured[key]}
            locale={locale}
            subActive={subActive}
            portalReturnUrl={portalReturnUrl}
            isDowngrade={subActive && PLAN_CARD_ORDER.indexOf(key) < activeIdx}
            isUpgrade={subActive && PLAN_CARD_ORDER.indexOf(key) > activeIdx}
          />
        ))}
      </div>
      <FreeStrip card={PLAN_CARDS.free} active={activePlan === "free"} />
    </>
  );
}

interface CardViewProps {
  card: PlanCard;
  active: boolean;
  configured: boolean;
  locale: string;
  subActive: boolean;
  portalReturnUrl: string;
  isDowngrade: boolean;
  isUpgrade: boolean;
}

function PlanCardView({
  card,
  active,
  configured,
  locale,
  subActive,
  portalReturnUrl,
  isDowngrade,
  isUpgrade,
}: CardViewProps) {
  // Suppress the "best value" ribbon on a tier below the active plan — a
  // downgrade should never wear the recommended crown.
  const showRibbon = card.featured && !isDowngrade;
  return (
    <div className={showRibbon ? "plancard featured" : "plancard"}>
      {showRibbon ? (
        <span className="plan-rec">Recommended · best value</span>
      ) : null}
      <div className="plan-name">{card.displayName}</div>
      <div className="plan-price">
        {card.priceUsd === 0 ? (
          "$0"
        ) : (
          <>
            ${card.priceUsd} <small>/ mo</small>
          </>
        )}
      </div>
      <div className="plan-credits">
        <CoinGlyph />
        {nf.format(card.monthlyCredits)} credits
        {card.oneTime ? " · one-time" : " / mo"}
      </div>

      {/* ONE primary yield figure — delivered leads/mo (Part D: not the dual). */}
      <div style={{ marginTop: 13 }}>
        <div
          style={{
            fontFamily: "var(--display)",
            fontSize: 27,
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: "-0.01em",
            color: "var(--indigo-700)",
          }}
        >
          {nf.format(card.withContacts)}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
          delivered leads{card.oneTime ? "" : " / mo"} · ≈{" "}
          {nf.format(card.fullyEnriched)} fully enriched
        </div>
      </div>

      <div className="plan-rate">{card.rate}</div>

      <ul className="plan-feat">
        {card.features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>

      {/* Review Part F · state the reset/expiry policy on the pre-purchase card
          (not just the wallet), so hard monthly expiry is never a surprise. */}
      {!card.oneTime ? (
        <p className="note" style={{ fontSize: 11, marginTop: -2 }}>
          Plan credits reset monthly · top-ups never expire
        </p>
      ) : null}

      <PlanCta
        card={card}
        active={active}
        configured={configured}
        locale={locale}
        subActive={subActive}
        portalReturnUrl={portalReturnUrl}
        isDowngrade={isDowngrade}
        isUpgrade={isUpgrade}
      />
    </div>
  );
}

/** Free plan — de-emphasized horizontal strip at the bottom (C2). */
function FreeStrip({ card, active }: { card: PlanCard; active: boolean }) {
  return (
    <div
      className="card"
      style={{
        marginTop: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        background: "var(--surface-2, #f6f7fb)",
        boxShadow: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontWeight: 750, fontSize: 15 }}>Free</span>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          {nf.format(card.withContacts)} leads with verified contacts · search
          everywhere we&apos;ve already mapped · no card required
        </span>
      </div>
      <span
        className="note"
        style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}
      >
        {active ? "Your current plan" : "Included with every account"}
      </span>
    </div>
  );
}

function PlanCta({
  card,
  active,
  configured,
  locale,
  subActive,
  portalReturnUrl,
  isDowngrade,
  isUpgrade,
}: CardViewProps) {
  // Filled/primary emphasis only when it's the featured tier AND not a
  // downgrade — a lower tier is never the loudest button for a paying agency.
  const primaryClass =
    card.featured && !isDowngrade
      ? "btn primary block plan-cta"
      : "btn block plan-cta";

  // Active plan → disabled "Current plan".
  if (active) {
    return (
      <button className="btn block plan-cta" disabled>
        Current plan
      </button>
    );
  }

  // Existing subscriber → CHANGE tier via the Stripe portal (never a fresh
  // checkout — that would create a second subscription, Part E).
  if (subActive) {
    const label = isUpgrade
      ? `Upgrade to ${card.displayName}`
      : `Switch to ${card.displayName}`;
    return (
      <form action={openBillingPortal} style={{ margin: 0 }}>
        <input type="hidden" name="returnUrl" value={portalReturnUrl} />
        <button type="submit" className={primaryClass}>
          {label}
        </button>
      </form>
    );
  }

  // No active subscription, Stripe price configured → NEW subscription checkout.
  if (configured) {
    return (
      <form action={startPlanCheckout} style={{ margin: 0 }}>
        <input type="hidden" name="plan" value={card.key} />
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" className={primaryClass}>
          Choose {card.displayName}
        </button>
      </form>
    );
  }

  // No active subscription, no Stripe price yet → disabled (graceful).
  return (
    <button
      className="btn block plan-cta"
      disabled
      data-tip="Checkout for this plan is being set up — available shortly."
    >
      Choose {card.displayName}
    </button>
  );
}
