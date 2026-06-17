import { Link } from "@/i18n/navigation";

import { ArrowGlyph, Dot } from "./fb-shared";

/**
 * SmbCTA · "See your reality. 30 seconds. Free."
 *
 * Closing band: a hero-style rounded card (90×90 grid + bottom red glow +
 * pulsing brand-red dots) on the dark page, single yellow CTA (one decision
 * per screen — Maria rule).
 *
 * Pure server component.
 */
interface SmbCTAProps {
  t: (key: string) => string;
}

export function SmbCTA({ t }: SmbCTAProps) {
  return (
    <section
      className="fb-section fb-dark fb-cta"
      aria-labelledby="fb-cta-title"
    >
      <div className="fb-container">
        <div className="fb-cta-box">
          <Dot style={{ top: "12%", left: "20%" }} />
          <Dot style={{ top: "calc(64% + 50px)", left: "30%" }} />
          <Dot style={{ top: "46%", right: "12%" }} />

          <div className="fb-cta-inner">
            <h2 id="fb-cta-title" className="fb-h2">
              {t("cta.title_lead")}{" "}
              <em className="fb-em fb-ylw">{t("cta.title_emph")}</em>
            </h2>
            <p className="fb-sub fb-sub--light">{t("cta.sub")}</p>
            <Link href="/signin" className="fb-btn">
              {t("cta.primary")} <ArrowGlyph />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
