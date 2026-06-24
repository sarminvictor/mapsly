import { Link } from "@/i18n/navigation";

import {
  ArrowGlyph,
  Dot,
} from "@/components/marketing/for-businesses/fb-shared";

/**
 * AgHero · /for-agencies 2026-06 redesign. Same gradient-mesh hero as the
 * SMB landing (grid overlay, fade-to-white, scattered dots), recoloured to
 * the agency indigo theme. Unlike the SMB hero there's no business-name
 * search — the agency page funnels to one CTA ("Start free" → /signin).
 *
 * Heading mixes the two brand faces: Space Grotesk base + a Bricolage
 * Grotesque accent span in brand yellow.
 *
 * Pure server component (the CTA is a plain link).
 */
interface AgHeroProps {
  t: (key: string) => string;
}

export function AgHero({ t }: AgHeroProps) {
  return (
    <section className="fb-hero fb-hero--ag" aria-labelledby="fb-ag-hero-title">
      <Dot style={{ top: "18%", left: "9%" }} />
      <Dot style={{ top: "34%", left: "16%" }} />
      <Dot style={{ top: "14%", right: "12%" }} />
      <Dot style={{ top: "42%", right: "7%" }} />
      <Dot style={{ top: "66%", left: "6%" }} />
      <Dot style={{ top: "72%", right: "14%" }} />

      <div className="fb-container fb-hero-inner">
        <span className="fb-ag-pill">
          <span className="fb-ag-pill-dot" aria-hidden />
          {t("hero.pill")}
        </span>

        <h1 id="fb-ag-hero-title" className="fb-h1">
          {t("hero.title_lead")}{" "}
          <em className="fb-em fb-ylw">{t("hero.title_emph")}</em>{" "}
          {t("hero.title_trail")}
        </h1>

        <p className="fb-sub">{t("hero.sub")}</p>

        <div className="fb-ag-hero-cta">
          <Link href="/signin" className="fb-btn" data-testid="agency-hero-cta">
            {t("hero.cta_primary")} <ArrowGlyph />
          </Link>
        </div>
      </div>
    </section>
  );
}
