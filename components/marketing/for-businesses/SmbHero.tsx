import Image from "next/image";

import { Dot } from "./fb-shared";
import { SmbSearch } from "./SmbSearch";

/**
 * SmbHero · 2026-06 redesign. Centered headline over a pink→teal gradient
 * mesh, social-proof pill, and the business-name search pill (the page's
 * single CTA — it leads into the signin/report funnel as a plain GET form,
 * zero client JS).
 *
 * Heading mixes the two brand faces: Space Grotesk base + Bricolage
 * Grotesque accent spans in brand yellow (per design).
 */
interface SmbHeroProps {
  t: (key: string) => string;
  /** Locale-prefixed signin path — plain string for the <form action>. */
  signinPath: string;
}

export function SmbHero({ t, signinPath }: SmbHeroProps) {
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

        <SmbSearch
          signinPath={signinPath}
          placeholder={t("hero.search_placeholder")}
          ariaLabel={t("hero.search_label")}
          cta={t("hero.search_cta")}
        />
      </div>
    </section>
  );
}
