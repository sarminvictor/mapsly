import Image from "next/image";

import { Dot } from "./fb-shared";
import { SmbSearch, type SmbSearchLabels } from "./SmbSearch";

/**
 * SmbHero · 2026-06 redesign. Centered headline over a pink→teal gradient
 * mesh, social-proof pill, and the business-name search pill (the page's
 * single CTA). The search autosuggests businesses we've already analyzed and
 * links to their personalized landing; no match opens a free-report lead form
 * (see SmbSearch). Labels are resolved here (server) into a plain object so no
 * function prop crosses the client boundary.
 *
 * Heading mixes the two brand faces: Space Grotesk base + Bricolage
 * Grotesque accent spans in brand yellow (per design).
 */
interface SmbHeroProps {
  t: (key: string) => string;
  /** App locale — recorded on captured leads. */
  locale: string;
}

export function SmbHero({ t, locale }: SmbHeroProps) {
  const searchLabels: SmbSearchLabels = {
    placeholder: t("hero.search_placeholder"),
    ariaLabel: t("hero.search_label"),
    cta: t("hero.search_cta"),
    resultsLabel: t("search.results_label"),
    noMatchTitle: t("search.no_match_title"),
    noMatchCta: t("search.no_match_cta"),
    modal: {
      title: t("lead_form.title"),
      subtitle: t("lead_form.subtitle"),
      businessLabel: t("lead_form.business_label"),
      businessPlaceholder: t("lead_form.business_placeholder"),
      emailLabel: t("lead_form.email_label"),
      emailPlaceholder: t("lead_form.email_placeholder"),
      submit: t("lead_form.submit"),
      sending: t("lead_form.sending"),
      successTitle: t("lead_form.success_title"),
      successBody: t("lead_form.success_body"),
      errorInvalid: t("lead_form.error_invalid"),
      errorRateLimited: t("lead_form.error_rate_limited"),
      errorGeneric: t("lead_form.error_generic"),
      close: t("lead_form.close"),
    },
  };

  return (
    <section className="fb-hero" aria-labelledby="fb-hero-title">
      <Dot style={{ top: "18%", left: "9%" }} />
      <Dot style={{ top: "34%", left: "16%" }} />
      <Dot style={{ top: "14%", right: "12%" }} />
      <Dot style={{ top: "42%", right: "7%" }} />
      <Dot style={{ top: "66%", left: "6%" }} />
      <Dot style={{ top: "72%", right: "14%" }} />

      <div className="fb-container fb-hero-inner">
        <div className="fb-hero-pill">
          {/* Placeholder portraits (randomuser.me) — swap for licensed
              shots before launch. Decorative: alt="" + aria-hidden row. */}
          <span className="fb-avatars" aria-hidden>
            {([1, 2, 3] as const).map((i) => (
              <Image
                key={i}
                src={`/avatars/owner-${i}.jpg`}
                alt=""
                width={32}
                height={32}
                className="fb-avatar"
              />
            ))}
          </span>
          <span className="fb-pill-lines">
            <span>
              <strong className="fb-pill-strong">
                {t("hero.pill_1_lead")}
              </strong>{" "}
              {t("hero.pill_1")}
            </span>
            <span>{t("hero.pill_2")}</span>
          </span>
        </div>

        <h1 id="fb-hero-title" className="fb-h1">
          {t("hero.title_lead")}{" "}
          <em className="fb-em fb-ylw">{t("hero.title_emph")}</em>{" "}
          {t("hero.title_mid")}
        </h1>

        <p className="fb-sub">{t("hero.sub")}</p>

        <SmbSearch labels={searchLabels} locale={locale} />
      </div>
    </section>
  );
}
