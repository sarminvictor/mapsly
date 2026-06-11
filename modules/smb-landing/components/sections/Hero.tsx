/**
 * Hero section — underlined business name, headline with serif-italic
 * emphasis, and the three score cards (Mapsly score gauge / city rank /
 * Google rating). Extracted verbatim from LandingView.tsx.
 */

import type { CSSProperties } from "react";

import type { LandingData } from "../../types";

import { CountUp, ScoreGauge } from "../LandingCounters";

import { Stars } from "./shared";
import { BODY, CONTAINER, SERIF, TREND_ARROW } from "./style-tokens";

// Card chrome (border-radius + padding) and the type sizes live in
// landing.css (.hero-card-* rules) — they have ≤560px overrides there.
const heroCard: CSSProperties = {
  position: "absolute",
  background: "#fff",
};

const heroCardTitle: CSSProperties = {
  margin: 0,
  fontFamily: SERIF,
  fontWeight: 700,
  color: "var(--color-text)",
};

const heroCardSub: CSSProperties = {
  margin: "4px 0 0",
  fontSize: 13.5,
  color: "var(--color-text-3)",
  lineHeight: 1.45,
};

/* --------------------------------------------------------------------- hero */

export function Hero({ data }: { data: LandingData }) {
  const cat = data.category.replace(/_/g, " ");
  const addr =
    [data.address, data.city].filter(Boolean).join(", ") ||
    data.cellLabel ||
    "";
  const trend = data.reviews.trend30d;
  return (
    <section
      data-landing-section="hero"
      style={{
        background: "#fff",
        marginTop: -82,
        padding:
          "calc(82px + clamp(20px, 3vw, 40px)) 20px clamp(36px, 5vw, 64px)",
        overflow: "clip",
      }}
    >
      <div
        className="landing-hero-grid"
        style={{
          ...CONTAINER,
          display: "grid",
          gap: 40,
          alignItems: "center",
        }}
      >
        <div style={{ position: "relative", zIndex: 1 }}>
          <p
            className="landing-hero-meta"
            style={{
              display: "inline-flex",
              gap: 10,
              margin: 0,
              fontSize: 14,
              color: "var(--color-text)",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                flexShrink: 0,
              }}
            >
              <svg
                width="11"
                height="8"
                viewBox="0 0 11 8"
                fill="none"
                aria-hidden
                style={{ flexShrink: 0 }}
              >
                <path
                  d="M0.421875 2.98171L3.56473 6.41028L9.75335 0.410278"
                  stroke="var(--color-coral)"
                  strokeWidth="1.14286"
                />
              </svg>
              <span style={{ color: "var(--color-text)" }}>{cat}</span>
            </span>
            <span
              aria-hidden
              className="landing-hero-meta-dot"
              style={{
                flexShrink: 0,
                width: 4,
                height: 4,
                borderRadius: 999,
                background: "#ECE6DE",
              }}
            />
            <span>{addr}</span>
          </p>
          <h1
            className="landing-hero-h1"
            style={{
              margin: "26px 0 0",
              fontFamily: SERIF,
              fontWeight: 700,
              lineHeight: 1.02,
              letterSpacing: "-0.02em",
              color: "var(--color-text)",
              textDecorationLine: "underline",
              textDecorationColor: "var(--color-coral)",
              textUnderlineOffset: "0.08em",
              textDecorationSkipInk: "none",
            }}
          >
            {data.name}
          </h1>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 18,
              marginTop: 34,
              maxWidth: 760,
            }}
          >
            <span
              aria-hidden
              className="landing-hero-rule"
              style={{
                flexShrink: 0,
                height: 2,
                background: "var(--color-coral)",
                marginTop: 30,
              }}
            />
            <p
              className="landing-hero-body"
              style={{
                margin: 0,
                lineHeight: 1.45,
                color: "var(--color-text)",
              }}
            >
              {data.copy.hero.headline}
              <span
                className="landing-hero-body"
                style={{
                  display: "block",
                  marginTop: 4,
                  color: "var(--color-text)",
                }}
              >
                {(() => {
                  const body = data.copy.hero.body;
                  const m = body.match(
                    /^([\s\S]*?)(roughly \d+–\d+ more \S+)([\s\S]*)$/,
                  );
                  if (!m) return body;
                  return (
                    <>
                      {m[1]}
                      <span
                        className="landing-hero-body-em"
                        style={{
                          fontFamily: SERIF,
                          fontStyle: "italic",
                          lineHeight: 0.85,
                          color: "var(--color-coral)",
                        }}
                      >
                        {m[2]}
                      </span>
                      {m[3]}
                    </>
                  );
                })()}
              </span>
            </p>
          </div>
        </div>

        <div>
          <div className="landing-hero-cards">
            <div className="hero-top-row">
              <div
                className="hero-card-1"
                style={{
                  ...heroCard,
                  position: "static",
                  width: "52%",
                  textAlign: "center",
                }}
              >
                <p className="hero-card-title" style={heroCardTitle}>
                  Mapsly score
                </p>
                <p style={heroCardSub}>your visibility to customers</p>
                <div
                  className="hero-gauge-wrap"
                  style={{
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  <ScoreGauge value={data.mapslyScore} />
                </div>
              </div>
              <div
                className="hero-card-2"
                style={{
                  ...heroCard,
                  position: "static",
                  textAlign: "center",
                }}
              >
                <p className="hero-card-title" style={heroCardTitle}>
                  City score
                </p>
                <p
                  className="hero-card-num hero-card-num-city"
                  style={{
                    margin: "4px 0 0",
                    fontFamily: SERIF,
                    fontWeight: 700,
                    lineHeight: 1,
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  {data.rank == null ? "—" : <CountUp value={data.rank} />}
                  {data.total != null ? (
                    <span
                      className="hero-city-slash"
                      style={{
                        fontFamily: BODY,
                        fontWeight: 600,
                        color: "var(--color-text)",
                        transform: "translateY(10px)",
                      }}
                    >
                      {" "}
                      / {data.total}
                    </span>
                  ) : null}
                </p>
                <p style={{ ...heroCardSub, marginTop: 21 }}>
                  Your position across all {cat}s in{" "}
                  {data.cellLabel ?? "your area"}
                </p>
              </div>
            </div>
            <div
              className="hero-card-3"
              style={{
                ...heroCard,
                position: "static",
                width: "50%",
                textAlign: "center",
              }}
            >
              <p className="hero-card-title" style={heroCardTitle}>
                Google
              </p>
              <p
                className="hero-card-num hero-card-num-google"
                style={{
                  fontFamily: SERIF,
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                {data.googleRating == null ? (
                  "—"
                ) : (
                  <CountUp value={data.googleRating} decimals={1} />
                )}
              </p>
              <div style={{ marginTop: 8 }}>
                <Stars value={data.googleRating} />
              </div>
              <p style={{ ...heroCardSub, marginTop: 18 }}>
                {data.reviewCount == null ? (
                  "—"
                ) : (
                  <CountUp value={data.reviewCount} grouping />
                )}{" "}
                reviews
              </p>
              {trend > 0 ? (
                <p
                  className="hero-card-trend"
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
                  <CountUp value={trend} prefix="+" /> this month
                </p>
              ) : null}
            </div>
          </div>
          <p
            style={{
              margin: "16px 0 0",
              textAlign: "center",
              fontSize: 13,
              color: "var(--color-text-3)",
            }}
          >
            Built from public data —{" "}
            <a
              href="#data-sources"
              style={{
                color: "inherit",
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              see how
            </a>
          </p>
        </div>
      </div>

      <div
        style={{
          textAlign: "center",
          marginTop: 24,
          position: "relative",
          zIndex: 2,
        }}
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-3)" }}>
          more info
        </p>
        <svg
          width="40"
          height="41"
          viewBox="0 0 40 41"
          fill="none"
          aria-hidden
          style={{ display: "block", margin: "6px auto 0" }}
        >
          <path
            d="M40 20L20.1641 40.1641L20 40.3291L19.8359 40.1641L0 20L20 38.6719L40 20Z"
            fill="var(--color-coral)"
          />
          <path
            opacity="0.4"
            d="M40 10L20.1641 30.1641L20 30.3291L19.8359 30.1641L0 10L20 28.6719L40 10Z"
            fill="var(--color-coral)"
          />
          <path
            opacity="0.1"
            d="M40 0L20.1641 20.1641L20 20.3291L19.8359 20.1641L0 0L20 18.6719L40 0Z"
            fill="var(--color-coral)"
          />
        </svg>
      </div>
    </section>
  );
}
