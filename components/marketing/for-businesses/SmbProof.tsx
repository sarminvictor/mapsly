import Image from "next/image";

import { QuoteGlyph, Stars } from "./fb-shared";
import { Carousel } from "./Carousel";

/**
 * SmbProof · "Twelve patients chose someone else this month."
 *
 * Three competitor-review cards — the emotional hook right under the hero.
 * Each card is a real-shaped Google review (initials avatar, 5★, quote)
 * that ends with which competitor the patient picked. Footnote keeps it
 * honest: pattern is real, names are changed.
 *
 * Pure server component.
 */
interface SmbProofProps {
  t: (key: string) => string;
}

const CARDS = [1, 2, 3] as const;

export function SmbProof({ t }: SmbProofProps) {
  return (
    <section
      className="fb-section fb-section--proof"
      aria-labelledby="fb-proof-title"
      data-fb-tone="light"
    >
      <div className="fb-container">
        <div className="fb-proof-head">
          <h2 id="fb-proof-title" className="fb-h2">
            {t("proof.title_lead")}{" "}
            <em className="fb-em fb-blueacc">{t("proof.title_emph")}</em>
          </h2>
          <p className="fb-sub">{t("proof.sub")}</p>
        </div>

        {/* desktop: 3-col grid · mobile: swipe slider with dots (CSS-driven) */}
        <Carousel className="fb-cards3" count={3} label={t("proof.sub")}>
          {CARDS.map((i) => (
            <article key={i} className="fb-review-card">
              <QuoteGlyph />
              <div className="fb-review-id">
                {/* Placeholder portraits (randomuser.me) — distinct from the
                    hero/reviews owner shots. Swap for licensed shots before
                    launch. Decorative: alt="". */}
                <Image
                  src={`/avatars/cust-${i}.jpg`}
                  alt=""
                  width={48}
                  height={48}
                  className="fb-review-avatar"
                />
                <div>
                  <div className="fb-review-name">{t(`proof.r${i}_name`)}</div>
                  <div className="fb-review-meta">{t(`proof.r${i}_meta`)}</div>
                </div>
                <span style={{ marginLeft: "auto" }}>
                  <Stars value={5} label={t("proof.stars_label")} />
                </span>
              </div>
              <p className="fb-review-text">{t(`proof.r${i}_text`)}</p>
              <div className="fb-review-chose">
                {t("proof.chose_label")}{" "}
                <span className="fb-chose-name">{t(`proof.r${i}_chose`)}</span>
              </div>
            </article>
          ))}
        </Carousel>

        <p className="fb-footnote">{t("proof.footnote")}</p>
      </div>
    </section>
  );
}
