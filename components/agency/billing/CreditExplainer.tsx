/**
 * Billing page header + credit explainer (prototype #view-billing lines
 * 7973–7979). The h1 highlights "credits" via `.hl`; the sub spells out the
 * credit economy. Copy is verbatim from the prototype.
 */
export function CreditExplainer() {
  return (
    <>
      <h1>
        Billing &amp; <span className="hl">credits</span>
      </h1>
      <p className="sub">
        Discovery is free. Every lead comes with contacts — go deeper only on
        the ones you&apos;ll pitch. <b>1 credit = 1 lead with contacts</b> ·{" "}
        <b>3 credits = 1 fully-enriched lead</b> (reviews, ads, SERP, AI
        research, compliance). <b>100 first-touch messages = 10 credits.</b>
      </p>
    </>
  );
}
