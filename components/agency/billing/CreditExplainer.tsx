/**
 * Billing page header + credit explainer. The h1 highlights "credits" via
 * `.hl`; the sub spells out the credit economy. Numbers derive from the pricing
 * constants (repriced 2026-07-09) so they can't drift from the wallet.
 */
import { CREDIT_MEANING } from "@/modules/cost/pricing";

export function CreditExplainer() {
  return (
    <>
      <h1>
        Billing &amp; <span className="hl">credits</span>
      </h1>
      <p className="sub">
        Go deeper only on the leads you&apos;ll pitch.{" "}
        <b>
          {CREDIT_MEANING.contacts} credit = 1 delivered lead with verified
          contacts
        </b>{" "}
        · <b>{CREDIT_MEANING.fullEnrichment} credits = 1 fully-enriched lead</b>{" "}
        (reviews, site speed, AI angle).{" "}
        <b>
          100 first-touch messages = {CREDIT_MEANING.firstTouchPer100} credits.
        </b>
      </p>
    </>
  );
}
