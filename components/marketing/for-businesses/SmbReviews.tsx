import Image from "next/image";

import { Stars } from "./fb-shared";
import { Reveal } from "./Reveal";

/**
 * SmbReviews · "Eight reviews you haven't answered yet."
 *
 * Green gradient band: pitch on the left, three unanswered-review cards on
 * the right, each with a decorative "Reply with AI" pill (non-interactive —
 * it illustrates the product, it doesn't navigate). Mixed ratings on purpose:
 * the unanswered-backlog story is about ALL reviews, not just angry ones.
 *
 * Pure server component.
 */
interface SmbReviewsProps {
  t: (key: string) => string;
}

const ROWS = [1, 2, 3] as const;

/** Render text with every "★" recolored yellow, the rest inheriting white. */
function TextWithStars({ text }: { text: string }) {
  const parts = text.split("★");
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 ? (
            <span className="fb-inline-star">★</span>
          ) : null}
        </span>
      ))}
    </>
  );
}

export function SmbReviews({ t }: SmbReviewsProps) {
  return (
    <section
      className="fb-section fb-stack-card fb-reviews"
      aria-labelledby="fb-reviews-title"
      data-fb-tone="dark"
    >
      <div className="fb-container fb-split">
        <div>
          <h2 id="fb-reviews-title" className="fb-h2">
            {t("reviews.title_lead")}{" "}
            <em className="fb-em fb-mintacc">{t("reviews.title_emph")}</em>
          </h2>
          <p className="fb-sub fb-reviews-sub">
            <TextWithStars text={t("reviews.sub")} />
          </p>
        </div>

        <div>
          {/* each card reveals on its own as it scrolls into view */}
          <div className="fb-review-rows">
            {ROWS.map((i) => (
              <Reveal key={i}>
                <article className="fb-review-row">
                  {/* Placeholder portraits — swap for licensed shots before
                    launch. Decorative: alt="". */}
                  <Image
                    src={`/avatars/rev-${i}.jpg`}
                    alt=""
                    width={48}
                    height={48}
                    className="fb-review-avatar"
                  />
                  <div className="fb-review-row-body">
                    <div className="fb-review-row-top">
                      <span className="fb-review-name">
                        {t(`reviews.r${i}_name`)}
                      </span>
                      <Stars
                        value={Number(t(`reviews.r${i}_stars`))}
                        label={t(`reviews.r${i}_stars_label`)}
                      />
                      <span className="fb-review-meta">
                        {t(`reviews.r${i}_meta`)}
                      </span>
                    </div>
                    <p className="fb-review-text">{t(`reviews.r${i}_text`)}</p>
                  </div>
                  <span
                    className="fb-btn fb-btn--reply"
                    aria-hidden="true"
                  >
                    {t("reviews.reply_cta")}
                  </span>
                </article>
              </Reveal>
            ))}
          </div>
          <p className="fb-footnote">{t("reviews.footnote")}</p>
        </div>
      </div>
    </section>
  );
}
