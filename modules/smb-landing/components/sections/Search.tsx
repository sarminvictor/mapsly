/**
 * Search section — "where you show up on Google": the stat card (total vs
 * captured searches), the keyword table, and the search problem→solution
 * callout. Extracted verbatim from LandingView.tsx.
 */

import type { CSSProperties } from "react";

import type { LandingCopy, LandingSearchData } from "../../types";

import { CountUp } from "../LandingCounters";

import {
  CtaPill,
  MissingNote,
  ProblemSolution,
  ScoreLine,
  SectionIntro,
  Td,
  Th,
  fmtNum,
} from "./shared";
import {
  CONTAINER,
  CTA_ROW,
  CTA_ROW_TIGHT,
  SERIF,
  STAT_UNIT_15,
  sectionStyle,
  tableStyle,
} from "./style-tokens";

export function SearchSection({
  search,
  category,
  copy,
  noun,
  ctaHref,
}: {
  search: LandingSearchData;
  category: string;
  copy: LandingCopy["search"];
  noun: string;
  ctaHref: string;
}) {
  const youGet = search.searchesYouGet;
  const total = search.searchesTotal;
  const others =
    youGet != null && total != null ? Math.max(0, total - youGet) : null;
  const cat = category.replace(/_/g, " ");
  return (
    <section data-landing-section="search" style={sectionStyle("white")}>
      <div style={CONTAINER}>
        <SectionIntro
          eyebrow={copy.eyebrow}
          title={copy.title}
          emphasis={copy.emphasis}
          intro={copy.intro}
        />

        {search.hasData ? (
          <div
            className="landing-2col landing-search-2col"
            style={{
              marginTop: 44,
              display: "grid",
              alignItems: "start",
            }}
          >
            {/* LEFT · stat card + extras under the card */}
            <div>
              <div
                style={{
                  background: "#F5F5F5",
                  borderRadius: 21,
                  padding: 28,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 12,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontFamily: SERIF,
                      fontSize: 22,
                      fontWeight: 700,
                      lineHeight: 1.2,
                      maxWidth: 230,
                    }}
                  >
                    Your stats based on the services you offer
                  </p>
                  <GoogleLogo />
                </div>
                <div
                  className="landing-search-stat-grid"
                  style={{
                    display: "grid",
                    marginTop: 26,
                  }}
                >
                  <div>
                    <p style={statCardLabel}>monthly Google searches:</p>
                    <p className="landing-stat-big" style={statCardBig}>
                      {total != null ? <CountUp value={total} grouping /> : "—"}
                      <span style={STAT_UNIT_15}> / mo</span>
                    </p>
                  </div>
                  <div>
                    <p style={statCardLabel}>Searches you show up only:</p>
                    <p
                      className="landing-stat-big"
                      style={{ ...statCardBig, color: "var(--color-coral)" }}
                    >
                      {youGet != null ? (
                        <CountUp value={youGet} grouping critical />
                      ) : (
                        "—"
                      )}
                      <span style={STAT_UNIT_15}> / mo</span>
                    </p>
                  </div>
                </div>
                {youGet != null && others != null ? (
                  <p
                    style={{
                      margin: "24px 0 0",
                      fontSize: 16,
                      lineHeight: 1.5,
                      color: "var(--color-text-2)",
                    }}
                  >
                    You show up for{" "}
                    <strong style={{ color: "var(--color-coral)" }}>
                      ~{fmtNum(youGet)} searches/mo.
                    </strong>{" "}
                    The other{" "}
                    <strong style={{ color: "var(--color-coral)" }}>
                      ~{fmtNum(others)}/mo
                    </strong>{" "}
                    go to other {cat}s.
                  </p>
                ) : null}
                {copy.lossLine ? (
                  <p
                    style={{
                      margin: "18px 0 0",
                      fontSize: 12,
                      lineHeight: 1.5,
                      fontWeight: 400,
                      color: "var(--color-text-3)",
                    }}
                  >
                    {copy.lossLine}
                  </p>
                ) : null}
              </div>
              <p
                className="landing-search-future"
                style={{
                  maxWidth: 440,
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: "var(--color-text-3)",
                  textAlign: "center",
                }}
              >
                {copy.futureLine}
              </p>
              <div className="landing-cta-inline">
                <div style={CTA_ROW}>
                  <ScoreLine value={search.pillar} />
                </div>
                <div style={CTA_ROW_TIGHT}>
                  <CtaPill
                    href={ctaHref}
                    cta="search"
                    label="See how to rank higher · $29/mo"
                  />
                </div>
              </div>
            </div>

            {/* RIGHT · keyword table */}
            <div>
              <p
                className="landing-subhead landing-subhead--search"
                style={{
                  fontFamily: SERIF,
                  fontWeight: 700,
                }}
              >
                How do people search for you on Google?
              </p>
              <div style={{ position: "relative", marginTop: 14 }}>
                <div className="landing-table-scroll landing-table-clip">
                  <table className="landing-table" style={tableStyle}>
                    <thead>
                      <tr>
                        <Th>Your service</Th>
                        <Th>Keywords</Th>
                        <Th align="right">Searches/mo</Th>
                        <Th align="right">Rate</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {search.topKeywords.map((k) => {
                        const rate = rateLabel(
                          bestOf(k.organicRank, k.mapsRank),
                        );
                        return (
                          <tr key={k.keyword}>
                            <Td>
                              <span style={{ fontWeight: 600, fontSize: 14 }}>
                                {k.service}
                              </span>
                            </Td>
                            <Td color="var(--color-text-3)">{`"${k.keyword}"`}</Td>
                            <Td align="right">
                              <span
                                style={{
                                  fontWeight: 600,
                                  fontSize: 14,
                                  color: "var(--color-text)",
                                }}
                              >
                                {fmtNum(k.volume)}
                              </span>
                            </Td>
                            <Td align="right" color={rate.color}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "flex-end",
                                  gap: 6,
                                  fontWeight: 600,
                                  fontSize: 14,
                                }}
                              >
                                {rate.label}
                                {rate.ok ? (
                                  <svg
                                    width="17"
                                    height="13"
                                    viewBox="0 0 17 13"
                                    fill="none"
                                    aria-hidden
                                    style={{ display: "block", flexShrink: 0 }}
                                  >
                                    <path
                                      d="M0.701172 4.96943L5.93927 10.6837L16.2536 0.683716"
                                      stroke="currentColor"
                                      strokeWidth="1.90476"
                                    />
                                  </svg>
                                ) : null}
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
                    height: 160,
                    background:
                      "linear-gradient(to bottom, transparent 0%, color-mix(in srgb, var(--color-bg-2) 55%, transparent) 60%, var(--color-bg-2) 100%)",
                    pointerEvents: "none",
                  }}
                />
              </div>
              {copy.gap ? <ProblemSolution gap={copy.gap} /> : null}
              <div className="landing-cta-stacked">
                <div style={CTA_ROW}>
                  <ScoreLine value={search.pillar} />
                </div>
                <div style={CTA_ROW_TIGHT}>
                  <CtaPill
                    href={ctaHref}
                    cta="search"
                    label="See how to rank higher · $29/mo"
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <MissingNote>
            {`We haven't scanned how you rank on Google yet. Start with Mapsly and we'll map every search ${noun} use to find businesses like yours — and exactly where you land.`}
          </MissingNote>
        )}
      </div>
    </section>
  );
}

function GoogleLogo() {
  const letters = ["G", "o", "o", "g", "l", "e"];
  const colors = [
    "#4285F4",
    "#EA4335",
    "#FBBC05",
    "#4285F4",
    "#34A853",
    "#EA4335",
  ];
  return (
    <span
      aria-label="Google"
      style={{
        fontFamily: "Arial, var(--font-landing-body)",
        fontWeight: 400,
        fontSize: 26,
        letterSpacing: "-0.5px",
        flexShrink: 0,
      }}
    >
      {letters.map((ch, i) => (
        <span key={i} style={{ color: colors[i] }}>
          {ch}
        </span>
      ))}
    </span>
  );
}

function bestOf(a: number | null, b: number | null): number | null {
  const vals = [a, b].filter((v): v is number => v != null);
  return vals.length ? Math.min(...vals) : null;
}

/** Rank → "Rate" label + tone, matching the design (in TOP-10 ✓ / not in TOP-20). */

function rateLabel(rank: number | null): {
  label: string;
  color: string;
  ok: boolean;
} {
  if (rank == null || rank > 20) {
    return { label: "not in TOP-20", color: "var(--color-coral)", ok: false };
  }
  if (rank <= 3) {
    return { label: "in TOP-3", color: "var(--color-success)", ok: true };
  }
  if (rank <= 10) {
    return { label: "in TOP-10", color: "var(--color-success)", ok: true };
  }
  return { label: "in TOP-20", color: "var(--color-gold)", ok: false };
}

const statCardLabel: CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-text)",
  lineHeight: 1.3,
  maxWidth: 128,
};

// margin lives on .landing-stat-big in landing.css (tightens at ≤560px).
// Fluid size: the two stats sit in narrow 2-up cells, so a 6-digit number
// (e.g. "131,850 / mo") overflowed at a fixed 65px. clamp shrinks it to fit the
// cell while staying prominent on wide screens (Viktor 2026-06-14).
const statCardBig: CSSProperties = {
  fontFamily: SERIF,
  fontSize: "clamp(36px, 4vw, 48px)",
  fontWeight: 700,
  lineHeight: 1,
  color: "var(--color-text)",
};
