import { Link } from "@/i18n/navigation";

import {
  ArrowGlyph,
  Dot,
} from "@/components/marketing/for-businesses/fb-shared";

/**
 * AgCTA · "See 50 leads. Free."
 *
 * Closing band — identical in style to the SMB closing CTA (hero-style
 * rounded card on the dark page: 90×90 grid + bottom red glow + pulsing
 * dots). The agency page has no hero search to focus, so the buttons are
 * plain links: primary "see 50 free leads" → /signin, secondary
 * "book a walkthrough" → /signin (ghost outline).
 *
 * Pure server component.
 */
interface AgCTAProps {
  t: (key: string) => string;
}

export function AgCTA({ t }: AgCTAProps) {
  return (
    <section
      className="fb-section fb-dark fb-cta"
      aria-labelledby="fb-ag-cta-title"
    >
      <div className="fb-container">
        <div className="fb-cta-box">
          <Dot style={{ top: "12%", left: "12%" }} />
          <Dot style={{ top: "calc(64% + 50px)", left: "7%" }} />
          <Dot style={{ top: "46%", right: "12%" }} />

          <div className="fb-cta-inner">
            <h2 id="fb-ag-cta-title" className="fb-h2">
              {t("cta.title_lead")}{" "}
              <em className="fb-em fb-ylw">{t("cta.title_emph")}</em>
            </h2>
            <p className="fb-sub fb-sub--light">{t("cta.sub")}</p>
            <div className="fb-ag-cta-actions">
              {/* audience=agency → self-serve agency provisioning (WP2-1). */}
              <Link
                href={{ pathname: "/signin", query: { audience: "agency" } }}
                className="fb-btn"
              >
                {t("cta.primary")} <ArrowGlyph />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
