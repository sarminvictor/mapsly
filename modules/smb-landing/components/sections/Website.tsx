/**
 * Website section — your Lighthouse-style score vs the market, the 12-check
 * audit table, and the website problem→solution callout. Extracted verbatim
 * from LandingView.tsx.
 */

import type { ReactNode } from "react";

import type { LandingCopy, LandingWebsiteData } from "../../types";

import { CountUp } from "../LandingCounters";

import {
  CtaPill,
  MissingNote,
  ProblemSolution,
  ScoreLine,
  SectionIntro,
  Td,
  Th,
} from "./shared";
import {
  CONTAINER,
  CTA_STACK,
  SERIF,
  STAT_UNIT_15,
  sectionStyle,
  tableStyle,
} from "./style-tokens";

export function WebsiteSection({
  website,
  city,
  copy,
  noun,
  ctaHref,
}: {
  website: LandingWebsiteData;
  city: string | null;
  copy: LandingCopy["website"];
  noun: string;
  ctaHref: string;
}) {
  const host = website.websiteUrl ? safeHost(website.websiteUrl) : null;
  const perf = website.performance;
  const yourColor =
    perf == null
      ? "var(--color-text)"
      : perf < 70
        ? "var(--color-coral)"
        : perf >= 90
          ? "var(--color-success)"
          : "var(--color-gold)";
  return (
    <section data-landing-section="website" style={sectionStyle("white")}>
      <div style={CONTAINER}>
        <SectionIntro
          eyebrow={copy.eyebrow}
          title={copy.title}
          emphasis={copy.emphasis}
          intro={copy.intro}
        />

        {website.hasData ? (
          <div
            className="landing-2col landing-web-grid"
            style={{
              marginTop: 44,
              display: "grid",
              alignItems: "start",
            }}
          >
            <div>
              <div
                style={{
                  background: "#F5F5F5",
                  borderRadius: 21,
                  padding: "44px 28px",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 18,
                    alignItems: "start",
                  }}
                >
                  <p
                    className="landing-subhead landing-subhead--web-score"
                    style={{
                      margin: 0,
                      fontFamily: SERIF,
                      fontWeight: 700,
                    }}
                  >
                    Score of your website:
                  </p>
                  <WebStat
                    label="Your score:"
                    value={perf != null ? Math.round(perf) : null}
                    sub={host ?? undefined}
                    color={yourColor}
                    pulse={yourColor === "var(--color-coral)"}
                    big
                  />
                </div>
                <div
                  className="landing-web-industry-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    marginTop: 24,
                  }}
                >
                  <WebStat
                    label={
                      <>
                        Industry median <br className="landing-br-mobile" />
                        (top 10):
                      </>
                    }
                    value={website.industryMedian}
                    sub={`midpoint of the top 10 sites${city ? ` in ${city}` : ""}`}
                  />
                  <WebStat
                    label={
                      <>
                        Industry best <br className="landing-br-mobile" />
                        (p90):
                      </>
                    }
                    value={website.industryBest}
                    sub="top 10% of websites in your category"
                  />
                </div>
              </div>
              <div className="landing-web-cta-desktop">
                <p
                  style={{
                    margin: "40px auto 0",
                    maxWidth: 440,
                    textAlign: "center",
                    fontSize: 14,
                    color: "var(--color-text-3)",
                    lineHeight: 1.5,
                  }}
                >
                  Full per-check breakdown with fix steps + weekly tracking
                  available on Mapsly Pro.
                </p>
                <div style={CTA_STACK}>
                  <ScoreLine value={website.pillar} />
                  <CtaPill
                    href={ctaHref}
                    cta="website"
                    label="Full per-check breakdown"
                  />
                </div>
              </div>
            </div>

            <div>
              <p
                className="landing-subhead landing-subhead--web-checks"
                style={{
                  margin: 0,
                  fontFamily: SERIF,
                  fontWeight: 700,
                }}
              >
                {website.passCount} of {website.totalChecks} checks passing.{" "}
                <span
                  className="landing-subhead"
                  style={{
                    color: "var(--color-text)",
                    fontWeight: 400,
                  }}
                >
                  What&apos;s missing:
                </span>
              </p>
              <div style={{ position: "relative", marginTop: 16 }}>
                <div className="landing-table-scroll landing-web-checks-scroll landing-table-clip">
                  <table className="landing-table" style={tableStyle}>
                    <thead>
                      <tr>
                        <Th>Check</Th>
                        <Th>Your stats</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {website.checks.map((c) => {
                        const ok = c.pass === true;
                        const fail = c.pass === false;
                        const col = ok
                          ? "var(--color-success)"
                          : fail
                            ? "var(--color-coral)"
                            : "var(--color-text-3)";
                        const detailNode = fail
                          ? (() => {
                              const m = c.detail?.match(
                                /^(.*?:\s*)([^·]+?)(\s*·[\s\S]*)$/,
                              );
                              const red = (
                                <strong
                                  style={{
                                    color: "var(--color-coral)",
                                    fontWeight: 600,
                                  }}
                                >
                                  {m ? m[2].trim() : c.detail}
                                </strong>
                              );
                              return m ? (
                                <>
                                  {m[1]}
                                  {red}
                                  {m[3]}
                                </>
                              ) : (
                                red
                              );
                            })()
                          : c.detail;
                        return (
                          <tr key={c.key}>
                            <Td>
                              <span style={{ fontWeight: 600 }}>{c.label}</span>
                            </Td>
                            <Td>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 8,
                                }}
                              >
                                <span
                                  aria-hidden
                                  style={{
                                    color: col,
                                    fontWeight: 600,
                                    width: 18,
                                    flexShrink: 0,
                                    display: "inline-flex",
                                    justifyContent: "center",
                                  }}
                                >
                                  {ok ? (
                                    <svg
                                      width="16"
                                      height="12"
                                      viewBox="0 0 17 13"
                                      fill="none"
                                      style={{
                                        display: "inline-block",
                                        verticalAlign: "middle",
                                      }}
                                    >
                                      <path
                                        d="M0.701172 4.96943L5.93927 10.6837L16.2536 0.683716"
                                        stroke="#7DA88B"
                                        strokeWidth="1.90476"
                                      />
                                    </svg>
                                  ) : fail ? (
                                    "✕"
                                  ) : (
                                    "·"
                                  )}
                                </span>
                                <span style={{ color: "var(--color-text-3)" }}>
                                  {detailNode}
                                </span>
                              </span>
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: 80,
                    background:
                      "linear-gradient(to bottom, transparent, var(--color-bg-2))",
                    pointerEvents: "none",
                  }}
                />
              </div>
              {copy.gap ? <ProblemSolution gap={copy.gap} /> : null}
              <div className="landing-web-cta-mobile">
                <p
                  style={{
                    margin: "28px auto 0",
                    maxWidth: 440,
                    textAlign: "center",
                    fontSize: 14,
                    color: "var(--color-text-3)",
                    lineHeight: 1.5,
                  }}
                >
                  Full per-check breakdown with fix steps + weekly tracking
                  available on Mapsly Pro.
                </p>
                <div style={CTA_STACK}>
                  <ScoreLine value={website.pillar} />
                  <CtaPill
                    href={ctaHref}
                    cta="website"
                    label="Full per-check breakdown"
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <MissingNote>
            {`We haven't audited your website yet. Mapsly checks it against the 12 things ${noun} (and Google) notice — speed, booking buttons, mobile, and more — every week.`}
          </MissingNote>
        )}
      </div>
    </section>
  );
}

function WebStat({
  label,
  value,
  sub,
  color,
  pulse,
}: {
  label: ReactNode;
  value: number | null;
  sub?: string;
  color?: string;
  big?: boolean;
  pulse?: boolean;
}) {
  return (
    <div>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          fontWeight: 600,
          color: "var(--color-text)",
          lineHeight: 1.3,
        }}
      >
        {label}
      </p>
      <p
        style={{
          margin: "8px 0 0",
          fontFamily: SERIF,
          fontSize: 70,
          fontWeight: 700,
          lineHeight: 1,
          color: color ?? "var(--color-text)",
        }}
      >
        {value == null ? "—" : <CountUp value={value} critical={pulse} />}
        <span style={STAT_UNIT_15}> / 100</span>
      </p>
      {sub ? (
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 16,
            color: "var(--color-text-3)",
            lineHeight: 1.4,
          }}
        >
          {sub}
        </p>
      ) : null}
    </div>
  );
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return (
      url
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0] ?? null
    );
  }
}
