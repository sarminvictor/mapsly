// SMB /ads · META block · "What's working in these ads" — structured analysis
// (replaces the old prose block). Four sub-parts, all SCANNABLE (stats/graphs,
// not prose):
//   1 · Format mix — % bars (video / image / …).
//   2 · Service mix — a TABLE: service · how many ads · "you offer this" flag.
//   3 · Promos — the offers running, with price when stated.
//   4 · Where they put their ads — % bars per platform (FB/IG vs the fringe).
//
// Server component · pure presentation. Every string arrives pre-resolved as a
// plain prop (cache-components Pattern 4b). No jargon (ui-ux-smb).

import * as React from "react";

const META_ACCENT = "#7a3ff5";

export interface FormatMixView {
  label: string; // "Video" | "Image" | …
  pct: number; // 0..100
}

export interface ServiceMixView {
  service: string;
  /** Pre-resolved "6 ads" / "1 ad" plural string. */
  adsText: string;
  pct: number; // 0..100 (share of analyzed ads · drives the bar)
  youOffer: boolean;
}

export interface PromoView {
  /** "Free consult · $99" — offer + price pre-resolved by the page. */
  text: string;
  hasPrice: boolean;
}

export interface PlatformStatView {
  label: string; // "Facebook", "Instagram", …
  pct: number; // 0..100 share of advertisers using it
  core: boolean; // FB / IG → highlighted as "where customers are"
}

export interface MetaMarketAnalysisLabels {
  formatHeading: string;
  serviceHeading: string;
  serviceColService: string;
  serviceColAds: string;
  promoHeading: string;
  platformHeading: string;
  platformHint: string; // one short caption under the platform bars
  youOfferChip: string;
  empty: string;
}

export function MetaMarketAnalysis({
  formatMix,
  serviceMix,
  promos,
  platformStats,
  labels,
}: {
  formatMix: FormatMixView[];
  serviceMix: ServiceMixView[];
  promos: PromoView[];
  platformStats: PlatformStatView[];
  labels: MetaMarketAnalysisLabels;
}) {
  const nothing =
    formatMix.length === 0 &&
    serviceMix.length === 0 &&
    promos.length === 0 &&
    platformStats.length === 0;
  if (nothing) {
    return (
      <p style={{ color: "var(--color-text-2)", fontSize: 14.5, margin: 0 }}>
        {labels.empty}
      </p>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        background: "var(--color-bg-2)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      {/* 1 · Format mix — % bars. */}
      {formatMix.length > 0 ? (
        <section>
          <SubHeading>{labels.formatHeading}</SubHeading>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {formatMix.map((f) => (
              <Bar
                key={f.label}
                label={f.label}
                pct={f.pct}
                accent={META_ACCENT}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* 2 · Service mix — TABLE: service · # ads · you-offer flag. */}
      {serviceMix.length > 0 ? (
        <section>
          <SubHeading>{labels.serviceHeading}</SubHeading>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}
          >
            <thead>
              <tr>
                <Th>{labels.serviceColService}</Th>
                <Th align="right">{labels.serviceColAds}</Th>
              </tr>
            </thead>
            <tbody>
              {serviceMix.map((s) => (
                <tr
                  key={s.service}
                  style={{
                    borderTop: "1px solid var(--color-border)",
                    background: s.youOffer
                      ? "rgba(45, 134, 89, 0.06)"
                      : "transparent",
                  }}
                >
                  <td style={{ padding: "9px 10px", verticalAlign: "middle" }}>
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--color-text)",
                        textTransform: "capitalize",
                      }}
                    >
                      {s.service}
                    </span>
                    {s.youOffer ? (
                      <span
                        style={{
                          marginLeft: 8,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "rgba(45, 134, 89, 0.12)",
                          color: "var(--color-success, #2d8659)",
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {labels.youOfferChip}
                      </span>
                    ) : null}
                  </td>
                  <td
                    style={{
                      padding: "9px 10px",
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--color-text-2)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.adsText}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {/* 3 · Promos — compact list, price emphasized when stated. */}
      {promos.length > 0 ? (
        <section>
          <SubHeading>{labels.promoHeading}</SubHeading>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {promos.map((p, i) => (
              <li
                key={`${p.text}-${i}`}
                style={{
                  fontSize: 14,
                  color: "var(--color-text)",
                  lineHeight: 1.45,
                  paddingLeft: 14,
                  position: "relative",
                  fontWeight: p.hasPrice ? 600 : 400,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    color: META_ACCENT,
                    fontWeight: 700,
                  }}
                >
                  ·
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 4 · Where they put their ads — % bars per platform. */}
      {platformStats.length > 0 ? (
        <section>
          <SubHeading>{labels.platformHeading}</SubHeading>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {platformStats.map((p) => (
              <Bar
                key={p.label}
                label={p.label}
                pct={p.pct}
                accent={p.core ? META_ACCENT : "var(--color-text-3)"}
              />
            ))}
          </div>
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 12.5,
              color: "var(--color-text-3)",
              lineHeight: 1.4,
            }}
          >
            {labels.platformHint}
          </p>
        </section>
      ) : null}
    </div>
  );
}

/** A labeled percent bar (shared by format + platform). */
function Bar({
  label,
  pct,
  accent,
}: {
  label: string;
  pct: number;
  accent: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span
        style={{
          width: 120,
          flexShrink: 0,
          fontSize: 13.5,
          color: "var(--color-text)",
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 10,
          borderRadius: 999,
          background: "var(--color-bg-3)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.max(2, Math.min(100, pct))}%`,
            height: "100%",
            borderRadius: 999,
            background: accent,
          }}
        />
      </div>
      <span
        style={{
          width: 40,
          flexShrink: 0,
          textAlign: "right",
          fontFamily: "var(--font-mono)",
          fontSize: 12.5,
          fontWeight: 600,
          color: "var(--color-text-2)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {pct}%
      </span>
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4
      style={{
        margin: "0 0 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        color: "var(--color-text-3)",
      }}
    >
      {children}
    </h4>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      style={{
        textAlign: align ?? "left",
        padding: "0 10px 6px",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--color-text-3)",
      }}
    >
      {children}
    </th>
  );
}
