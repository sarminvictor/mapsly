/**
 * The 4-card plans grid (prototype #view-billing lines 8049–8189).
 *
 * Free / Starter / Growth (featured) / Scale, each with: name, price, monthly
 * credit allotment, dual-outcome yield (fully-enriched vs with-contacts),
 * effective rate, ✓-bulleted features, the indigo worked-example box, and a CTA.
 *
 * CTA behaviour:
 *   - The ACTIVE plan renders a disabled "Current plan" button.
 *   - The FREE card renders a static "Start free" (no checkout — it's the
 *     default tier).
 *   - A paid plan with a configured Stripe price id renders a `<form>` that
 *     POSTs `startPlanCheckout` (subscription checkout).
 *   - A paid plan whose price id is NOT configured renders a disabled
 *     "Contact us" button (graceful degradation — the human still has to
 *     create the Stripe product).
 *
 * Server-presentational: the CTA is a server-action `<form>`, so nothing
 * crosses a `'use client'` boundary.
 */

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
}

export function PlansGrid({ activePlan, configured, locale }: PlansGridProps) {
  return (
    <>
      <div className="eyebrow" style={{ margin: "26px 0 10px" }}>
        Plans
      </div>
      <div className="plans">
        {PLAN_CARD_ORDER.map((key) => (
          <PlanCardView
            key={key}
            card={PLAN_CARDS[key]}
            active={key === activePlan}
            configured={key === "free" ? false : configured[key]}
            locale={locale}
          />
        ))}
      </div>
    </>
  );
}

function PlanCardView({
  card,
  active,
  configured,
  locale,
}: {
  card: PlanCard;
  active: boolean;
  configured: boolean;
  locale: string;
}) {
  return (
    <div className={card.featured ? "plancard featured" : "plancard"}>
      {card.featured ? (
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

      <div className="plan-yield">
        <div className="y">
          <div className="yn">{nf.format(card.fullyEnriched)}</div>
          <div className="yl">fully enriched</div>
        </div>
        <div className="y contacts">
          <div className="yn">{nf.format(card.withContacts)}</div>
          <div className="yl">with contacts</div>
        </div>
      </div>

      <div className="plan-rate">{card.rate}</div>

      <ul className="plan-feat">
        {card.features.map((f, i) => (
          <li
            key={f}
            className={
              card.key === "free" && i === card.features.length - 1
                ? "muted"
                : undefined
            }
          >
            {f}
          </li>
        ))}
      </ul>

      <div className="plan-calc">{card.calc}</div>

      <PlanCta
        card={card}
        active={active}
        configured={configured}
        locale={locale}
      />
    </div>
  );
}

function PlanCta({
  card,
  active,
  configured,
  locale,
}: {
  card: PlanCard;
  active: boolean;
  configured: boolean;
  locale: string;
}) {
  // Active plan → disabled "Current plan".
  if (active) {
    return (
      <button className="btn block plan-cta" disabled>
        Current plan
      </button>
    );
  }

  // Free tier → static informational CTA (no checkout).
  if (card.key === "free") {
    return (
      <button className="btn primary block plan-cta" disabled>
        Free plan
      </button>
    );
  }

  // Paid plan, Stripe price configured → real subscription checkout.
  if (configured) {
    return (
      <form action={startPlanCheckout} style={{ margin: 0 }}>
        <input type="hidden" name="plan" value={card.key} />
        <input type="hidden" name="locale" value={locale} />
        <button
          type="submit"
          className={
            card.featured ? "btn primary block plan-cta" : "btn block plan-cta"
          }
        >
          Choose {card.displayName}
        </button>
      </form>
    );
  }

  // Paid plan, no Stripe price yet → graceful "contact us".
  return (
    <button
      className="btn block plan-cta"
      disabled
      title="Checkout not configured yet — contact us to upgrade."
    >
      Contact us
    </button>
  );
}
