/**
 * Ads section — competitors paying to be the answer: market ad stats, the
 * advertisers table, and the stacked problem→solution callout. Extracted
 * verbatim from LandingView.tsx.
 */

import type { LandingAdsData, LandingCopy } from "../../types";

import { CountUp } from "../LandingCounters";

import {
  CtaPill,
  MissingNote,
  ProblemSolutionStacked,
  ScoreLine,
  SectionIntro,
  Td,
  Th,
  fmtNum,
} from "./shared";
import {
  CONTAINER,
  SERIF,
  SUBHEAD_30,
  sectionStyle,
  tableStyle,
} from "./style-tokens";

/* ------------------------------------------------------------- ads section */

export function AdsSection({
  ads,
  name,
  copy,
  noun,
  ctaHref,
}: {
  ads: LandingAdsData;
  name: string;
  copy: LandingCopy["ads"];
  noun: string;
  ctaHref: string;
}) {
  return (
    <section data-landing-section="ads" style={sectionStyle("white")}>
      <div style={CONTAINER}>
        <SectionIntro
          eyebrow={copy.eyebrow}
          title={copy.title}
          emphasis={copy.emphasis}
          intro={copy.intro}
        />

        {ads.hasData ? (
          <>
            <div
              className="landing-2col landing-ads-grid"
              style={{
                display: "grid",
                alignItems: "start",
              }}
            >
              <div>
                <p className="landing-subhead" style={SUBHEAD_30}>
                  {name} stats:
                </p>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 36,
                    marginTop: 28,
                  }}
                >
                  <AdStat
                    label="Ads near you in your market"
                    value={ads.marketActiveAds}
                    unit="ads"
                  />
                  <AdStat
                    label="Competitors advertising"
                    value={ads.marketAdvertiserCount}
                    unit={ads.marketAdvertiserCount === 1 ? "rival" : "rivals"}
                  />
                  <AdStat
                    label="Ads you're running"
                    value={ads.ownAdCount}
                    unit={ads.ownAdCount === 1 ? "ad" : "ads"}
                    coral
                  />
                </div>
              </div>
              <div className="landing-ads-ps-desktop">
                {copy.gap ? <ProblemSolutionStacked gap={copy.gap} /> : <div />}
              </div>
            </div>

            <div
              className="landing-ads-table-block"
              style={{
                maxWidth: 840,
                marginInline: "auto",
              }}
            >
              <p className="landing-subhead" style={SUBHEAD_30}>
                Ads running near you:
              </p>
              <div className="landing-table-scroll">
                <table
                  className="landing-table"
                  style={{
                    ...tableStyle,
                    marginTop: 16,
                    width: "100%",
                  }}
                >
                  <thead>
                    <tr>
                      <Th>Advertiser near you</Th>
                      <Th align="right">
                        <span style={{ whiteSpace: "nowrap" }}>Active ads</span>
                      </Th>
                      <Th>Where</Th>
                      <Th align="right">Yours?</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {ads.competitors.map((c) => (
                      <tr key={`${c.platforms.join("-")}-${c.name}`}>
                        <Td>
                          <span style={{ fontWeight: 600 }}>{c.name}</span>
                        </Td>
                        <Td align="right">
                          <span style={{ fontWeight: 600 }}>
                            {fmtNum(c.activeAds)}
                          </span>
                        </Td>
                        <Td color="var(--color-text-3)">
                          {c.platforms.length
                            ? c.platforms
                                .map((p) =>
                                  p
                                    .toLowerCase()
                                    .replace(/_/g, " ")
                                    .replace(/\b\w/g, (ch) => ch.toUpperCase()),
                                )
                                .join(", ")
                            : "—"}
                        </Td>
                        <Td
                          align="right"
                          color={
                            c.isOwn
                              ? "var(--color-success)"
                              : "var(--color-coral)"
                          }
                        >
                          <span style={{ fontWeight: 600 }}>
                            {c.isOwn ? (
                              <>
                                yes ✓{" "}
                                <span
                                  style={{
                                    color: "var(--color-text-3)",
                                    fontWeight: 400,
                                  }}
                                >
                                  ({c.platforms.join(", ") || "—"})
                                </span>
                              </>
                            ) : (
                              "no"
                            )}
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {copy.gap ? (
              <div className="landing-ads-ps-mobile">
                <ProblemSolutionStacked gap={copy.gap} />
              </div>
            ) : null}

            <div
              style={{
                marginTop: 36,
                display: "grid",
                gap: 6,
                justifyItems: "center",
              }}
            >
              <ScoreLine value={ads.pillar} />
              <CtaPill href={ctaHref} cta="ads" label="Start tracking" />
            </div>
          </>
        ) : (
          <MissingNote>
            {`We haven't mapped the ads running in your area yet. Mapsly tracks every competitor advertising on Google and Meta for your services — so you see who's buying the ${noun} you could win.`}
          </MissingNote>
        )}
      </div>
    </section>
  );
}

function AdStat({
  label,
  value,
  unit,
  coral,
}: {
  label: string;
  value: number;
  unit: string;
  coral?: boolean;
}) {
  return (
    <div style={{ minWidth: 120 }}>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          fontWeight: 600,
          color: "var(--color-text)",
          lineHeight: 1.3,
          maxWidth: 100,
        }}
      >
        {label}
      </p>
      <p
        className="landing-adstat-num"
        style={{
          fontFamily: SERIF,
          fontSize: 50,
          fontWeight: 700,
          lineHeight: 1,
          color: coral ? "var(--color-coral)" : "var(--color-text)",
        }}
      >
        <CountUp
          value={value}
          grouping
          critical={coral}
          unit={<span style={{ fontSize: 50, fontWeight: 400 }}> {unit}</span>}
        />
      </p>
    </div>
  );
}
