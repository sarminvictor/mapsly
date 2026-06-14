/**
 * Reviews section — your Google score band, the competitor comparison table
 * (with the highlighted "You!" row), review themes, and the reviews
 * problem→solution callout. Extracted verbatim from LandingView.tsx.
 */

import { Fragment } from "react";

import type { LandingCopy, LandingReviewsData } from "../../types";

import { CountUp } from "../LandingCounters";

import {
  MissingNote,
  ProblemSolution,
  RankBadge,
  STAR_D,
  ScoreLine,
  SectionFooterCta,
  SectionIntro,
  Stars,
  Td,
  Th,
  fmtNum,
  fmtPct,
  fmtRating,
} from "./shared";
import {
  CONTAINER,
  ROW_FLEX_10,
  SERIF,
  STAR_INLINE,
  TREND_ARROW,
  sectionStyle,
  tableStyle,
} from "./style-tokens";

export function ReviewsSection({
  reviews,
  copy,
  noun,
  ctaHref,
}: {
  reviews: LandingReviewsData;
  copy: LandingCopy["reviews"];
  noun: string;
  ctaHref: string;
}) {
  // Scenario 1 (you're in the top 3): competitors are ranks 1–5 and the
  // table fades out below. Scenario 2 (below 3): ranks 1–3 then your row at
  // its real rank after a "⋮" gap, no fade.
  const ownRow = reviews.competitors.find((c) => c.isOwn);
  const ownBelowTop3 = ownRow != null && ownRow.rank > 3;
  const fadeTable = !ownBelowTop3;
  return (
    <section data-landing-section="reviews" style={sectionStyle("white")}>
      <div style={CONTAINER}>
        <SectionIntro
          eyebrow={copy.eyebrow}
          title={copy.title}
          emphasis={copy.emphasis}
          intro={copy.intro}
        />

        {reviews.hasData ? (
          <>
            <div
              className="landing-reviews-score"
              style={{
                marginTop: 40,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                background: "#F5F5F5",
                borderRadius: 18,
                maxWidth: 965,
                marginInline: "auto",
              }}
            >
              <span
                className="landing-reviews-score-label"
                style={{ fontWeight: 600 }}
              >
                Your Google score:
              </span>
              <span
                className="landing-reviews-score-num"
                style={{ fontFamily: SERIF, fontWeight: 600 }}
              >
                {fmtRating(reviews.rating)}
              </span>
              <Stars value={reviews.rating} />
              <span style={{ color: "var(--color-text-3)", fontSize: 14 }}>
                {fmtNum(reviews.reviewCount)} reviews
              </span>
              {reviews.trend30d > 0 ? (
                <span
                  style={{
                    color: "var(--color-success)",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden
                    style={TREND_ARROW}
                  >
                    <path
                      d="M3.65039 12.1366L12.1205 3.66652"
                      stroke="var(--color-success)"
                      strokeWidth="1.49732"
                    />
                    <path
                      d="M11.9258 3.43972V11.2258"
                      stroke="var(--color-success)"
                      strokeWidth="1.49732"
                    />
                    <path
                      d="M12.3789 3.89323H4.59285"
                      stroke="var(--color-success)"
                      strokeWidth="1.49732"
                    />
                  </svg>
                  +{reviews.trend30d} this month
                </span>
              ) : null}
            </div>

            <div
              className="landing-2col landing-reviews-grid"
              style={{
                display: "grid",
                alignItems: "start",
              }}
            >
              <div>
                <p
                  className="landing-subhead"
                  style={{
                    margin: "0 0 8px",
                    fontFamily: SERIF,
                    fontWeight: 700,
                  }}
                >
                  You compared to your competitors:
                </p>
                <div className="landing-table-scroll landing-table-scroll-glow">
                  <table className="landing-table" style={tableStyle}>
                    <colgroup>
                      <col style={{ width: "40%" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <Th>
                          <span
                            style={{
                              display: "inline-block",
                              maxWidth: 70,
                              marginLeft: 32,
                            }}
                          >
                            Company name
                          </span>
                        </Th>
                        <Th>Google reviews score</Th>
                        <Th>Number of reviews</Th>
                        <Th>Review trend (last 30d)</Th>
                        <Th>Response rate</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviews.competitors.map((c, i) => {
                        const own = c.isOwn;
                        const txt = "var(--color-text)";
                        const prevRank = reviews.competitors[i - 1]?.rank;
                        const gapRow =
                          prevRank != null && c.rank > prevRank + 1;
                        // Scenario 1: fade the bottom rows instead of a mask —
                        // the 5th at 40% opacity, the 4th at 70%.
                        const lastIdx = reviews.competitors.length - 1;
                        const rowOpacity = !fadeTable
                          ? undefined
                          : i === lastIdx
                            ? 0.4
                            : i === lastIdx - 1
                              ? 0.7
                              : undefined;

                        // Your-business row — REAL metrics, highlighted "You"
                        // styling. Present only when you're not already in the
                        // top 3 (gated by buildReviews in queries.ts).
                        if (own) {
                          // Top-3 → green (you're winning); below 3 → coral with
                          // red low values (you're behind).
                          const accent =
                            c.rank <= 3
                              ? "var(--color-success)"
                              : "var(--color-coral)";
                          const lowVal =
                            c.rank <= 3
                              ? "var(--color-text)"
                              : "var(--color-coral)";
                          return (
                            <Fragment key={`${c.name}-${c.rank}`}>
                              {gapRow ? (
                                <tr>
                                  <Td color="var(--color-text-3)">
                                    <span
                                      aria-hidden
                                      style={{
                                        paddingLeft: 6,
                                        fontSize: 18,
                                        lineHeight: 1,
                                      }}
                                    >
                                      ⋮
                                    </span>
                                  </Td>
                                  <Td>{""}</Td>
                                  <Td>{""}</Td>
                                  <Td>{""}</Td>
                                  <Td>{""}</Td>
                                </tr>
                              ) : null}
                              <tr>
                                <Td color={accent} weight={600}>
                                  <span style={ROW_FLEX_10}>
                                    <span
                                      style={{
                                        display: "inline-grid",
                                        placeItems: "center",
                                        width: 22,
                                        height: 22,
                                        borderRadius: "50%",
                                        background: accent,
                                        color: "#fff",
                                        fontSize: 11,
                                        fontWeight: 600,
                                        flexShrink: 0,
                                        boxShadow: `0 0 20px 0 ${accent}`,
                                      }}
                                    >
                                      {c.rank}
                                    </span>
                                    <span
                                      style={{
                                        fontWeight: 600,
                                        color: "var(--color-text)",
                                      }}
                                    >
                                      {c.name}
                                    </span>
                                    <em
                                      style={{
                                        fontFamily: SERIF,
                                        fontSize: 24,
                                        color: accent,
                                        fontStyle: "italic",
                                        fontWeight: 700,
                                      }}
                                    >
                                      (You!)
                                    </em>
                                  </span>
                                </Td>
                                <Td color="var(--color-text)" weight={600}>
                                  {fmtRating(c.rating)}{" "}
                                  <svg
                                    width="13"
                                    height="12"
                                    viewBox="0 0 18 17"
                                    fill="none"
                                    aria-hidden
                                    style={STAR_INLINE}
                                  >
                                    <path
                                      d={STAR_D}
                                      fill="#FCC800"
                                      stroke="#FCC800"
                                      strokeWidth="1.42452"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </Td>
                                <Td color={lowVal} weight={600}>
                                  {fmtNum(c.reviewCount)}
                                </Td>
                                <Td color={lowVal} weight={600}>
                                  {c.trend30d ?? 0}
                                </Td>
                                <Td color="var(--color-text)" weight={600}>
                                  {fmtPct(c.responseRate)}
                                </Td>
                              </tr>
                            </Fragment>
                          );
                        }

                        return (
                          <tr
                            key={`${c.name}-${c.rank}`}
                            style={
                              rowOpacity != null
                                ? { opacity: rowOpacity }
                                : undefined
                            }
                          >
                            <Td
                              color="var(--color-text)"
                              weight={600}
                              borderOpacity={rowOpacity}
                            >
                              <span style={ROW_FLEX_10}>
                                {gapRow ? (
                                  <span
                                    style={{ color: "var(--color-text-3)" }}
                                    aria-hidden
                                  >
                                    ⋮
                                  </span>
                                ) : null}
                                <RankBadge rank={c.rank} isOwn={own} />
                                <span style={{ fontWeight: 600 }}>
                                  {c.name}
                                </span>
                              </span>
                            </Td>
                            <Td
                              color={txt}
                              weight={600}
                              borderOpacity={rowOpacity}
                            >
                              {fmtRating(c.rating)}{" "}
                              <svg
                                width="13"
                                height="12"
                                viewBox="0 0 18 17"
                                fill="none"
                                aria-hidden
                                style={STAR_INLINE}
                              >
                                <path
                                  d={STAR_D}
                                  fill="#FCC800"
                                  stroke="#FCC800"
                                  strokeWidth="1.42452"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </Td>
                            <Td
                              color={txt}
                              weight={600}
                              borderOpacity={rowOpacity}
                            >
                              {fmtNum(c.reviewCount)}
                            </Td>
                            <Td
                              color={txt}
                              weight={600}
                              borderOpacity={rowOpacity}
                            >
                              {c.trend30d ?? 0}
                            </Td>
                            <Td
                              color={txt}
                              weight={600}
                              borderOpacity={rowOpacity}
                            >
                              {fmtPct(c.responseRate)}
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div
                style={{
                  borderLeft: "1px solid #F1F4F6",
                  paddingLeft: 24,
                  marginLeft: -24,
                }}
              >
                <p
                  className="landing-subhead landing-subhead--themes"
                  style={{
                    margin: 0,
                    fontFamily: SERIF,
                    fontWeight: 700,
                  }}
                >
                  {`What services ${noun} mention in your reviews?`}
                </p>
                {reviews.themes.length > 0 ? (
                  <div
                    style={{
                      display: "grid",
                      gap: 7,
                      marginTop: 16,
                      maxWidth: 520,
                    }}
                  >
                    {reviews.themes.slice(0, 3).map((t) => (
                      <div
                        key={t.label}
                        style={{ display: "flex", alignItems: "center" }}
                      >
                        <div
                          className="landing-theme-card"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            height: 87,
                            boxSizing: "border-box",
                            background: "#F5F5F5",
                            borderRadius: "22px 22px 22px 0",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 16,
                              color: "var(--color-text-2)",
                              lineHeight: 1.3,
                            }}
                          >
                            <strong style={{ color: "var(--color-success)" }}>
                              {t.label}
                            </strong>{" "}
                            mentioned by {noun}
                          </span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            flexShrink: 0,
                            marginLeft: -13,
                            position: "relative",
                            zIndex: 1,
                          }}
                        >
                          <span
                            style={{
                              width: 26,
                              height: 2,
                              background: "var(--color-coral)",
                            }}
                            aria-hidden
                          />
                          <span
                            className="landing-theme-numwrap"
                            style={{
                              display: "inline-flex",
                            }}
                          >
                            <span
                              className="landing-theme-count"
                              style={{
                                fontFamily: SERIF,
                                fontWeight: 600,
                              }}
                            >
                              <CountUp value={t.count} />
                            </span>
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "var(--color-text)",
                              }}
                            >
                              times
                            </span>
                          </span>
                        </div>
                      </div>
                    ))}
                    {/* Same 12-calendar-month window as the portal's
                        "Your services in reviews" card (lib/review-window) —
                        the two surfaces must always show identical counts. */}
                    <p
                      style={{
                        margin: "6px 0 0",
                        fontSize: 11,
                        color: "var(--color-text-3)",
                      }}
                    >
                      From your Google reviews · last 12 months
                    </p>
                  </div>
                ) : (
                  <p
                    style={{
                      marginTop: 14,
                      fontSize: 13.5,
                      color: "var(--color-text-3)",
                    }}
                  >
                    {`We'll surface the services ${noun} mention once your reviews are analyzed.`}
                  </p>
                )}
              </div>
            </div>

            {copy.gap ? (
              <div style={{ maxWidth: 965, marginInline: "auto" }}>
                <ProblemSolution gap={copy.gap} />
              </div>
            ) : null}
            <div style={{ marginTop: 24, textAlign: "center" }}>
              <ScoreLine value={reviews.pillar} />
            </div>
          </>
        ) : (
          <MissingNote>
            {`We haven't pulled your reviews yet. Mapsly reads every review you and your competitors get — what ${noun} praise, what they complain about, and how fast owners reply.`}
          </MissingNote>
        )}

        <SectionFooterCta
          ctaHref={ctaHref}
          cta="reviews"
          label="Reply to reviews faster"
        />
      </div>
    </section>
  );
}
