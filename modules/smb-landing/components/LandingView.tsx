/**
 * Public landing page view (`/l/[slug]-[token]`).
 *
 * A personalized, single-scroll proposal assembled from the business's REAL
 * latest snapshot data — the surface we email a qualified SMB to convert them
 * into a $29/mo subscriber. Mirrors the SMB portal sections (score, market
 * changes, search, ads, reviews, website, fixes) as warm marketing copy.
 *
 * Server component · inline styles + CSS vars per the marketing convention.
 * `data-landing-section` / `data-landing-cta` hooks let the client analytics
 * layer (LandingAnalytics) observe scroll-depth + clicks without touching this
 * markup. Honest "we don't track this yet" notes stand in for any missing
 * section — those gaps are themselves the reason to subscribe.
 *
 * Per `.claude/rules/ui-ux-smb.md`: warm, plain English, Maria's vocabulary,
 * one clear action (Start tracking · $29/mo). Per `.claude/rules/copy-voice.md`
 * the headline copy is template-level (to be reworked) — the DATA is real.
 */

import type { CSSProperties, ReactNode } from "react";

import type { SmbMarketChange, SmbOverviewFix } from "@/modules/smb-home/types";
import type {
  LandingAdsData,
  LandingData,
  LandingReviewsData,
  LandingSearchData,
  LandingWebsiteData,
} from "../types";

import { LandingAnalytics } from "./LandingAnalytics";

/* ----------------------------------------------------------------- helpers */

function fmtScore(v: number | null): string {
  return v == null ? "—" : v.toFixed(1);
}
function scoreTone(v: number | null): "good" | "warn" | "bad" | "none" {
  if (v == null) return "none";
  if (v >= 7) return "good";
  if (v >= 4) return "warn";
  return "bad";
}
function toneColor(t: "good" | "warn" | "bad" | "none"): string {
  return t === "good"
    ? "var(--color-success)"
    : t === "warn"
      ? "var(--color-gold)"
      : t === "bad"
        ? "var(--color-coral)"
        : "var(--color-text-3)";
}
function fmtRating(v: number | null): string {
  return v == null ? "—" : v.toFixed(1);
}
function fmtNum(v: number | null): string {
  return v == null ? "—" : new Intl.NumberFormat("en-US").format(v);
}
function fmtPct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
function rankColumns(rank: number | null): string {
  return rank == null ? "—" : ordinal(rank);
}

/** A rough "more customers" estimate from real search opportunity (visits we
 * could win back on keywords where the business isn't yet top-3). Honest: only
 * shown when there's a basis; otherwise the hero copy omits the number. */
function estMoreCustomers(search: LandingSearchData): number | null {
  if (!search.hasData) return null;
  let total = 0;
  for (const k of search.topKeywords) {
    const best = [k.organicRank, k.mapsRank].filter(
      (r): r is number => r != null,
    );
    const isTop3 = best.length > 0 && Math.min(...best) <= 3;
    if (!isTop3 && k.estCustomers) total += k.estCustomers;
  }
  if (total <= 0) return null;
  return Math.max(5, Math.floor(total / 5) * 5);
}

/* -------------------------------------------------------------- primitives */

function ScoreGauge({
  value,
  size = 96,
}: {
  value: number | null;
  size?: number;
}) {
  const tone = scoreTone(value);
  const color = toneColor(tone);
  const pct =
    value == null ? 0 : Math.max(0, Math.min(100, (value / 10) * 100));
  const ring: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    background: `conic-gradient(${color} ${pct}%, var(--color-bg-3) ${pct}% 100%)`,
    display: "grid",
    placeItems: "center",
  };
  const inner: CSSProperties = {
    width: size - 16,
    height: size - 16,
    borderRadius: "50%",
    background: "var(--color-bg-2)",
    display: "grid",
    placeItems: "center",
  };
  return (
    <div
      style={ring}
      role="img"
      aria-label={
        value == null ? "Not scored yet" : `${value.toFixed(1)} out of 10`
      }
    >
      <div style={inner}>
        <span
          style={{
            fontFamily: "var(--font-landing-head)",
            fontSize: size * 0.34,
            fontWeight: 600,
            color: "var(--color-text)",
            lineHeight: 1,
          }}
        >
          {fmtScore(value)}
        </span>
      </div>
    </div>
  );
}

function ScoreChip({ value, label }: { value: number | null; label: string }) {
  const tone = scoreTone(value);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 14px",
        borderRadius: 999,
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        fontFamily: "var(--font-landing-body)",
        fontSize: 13,
        color: "var(--color-text-2)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--color-text-3)",
        }}
      >
        {label}
      </span>
      <span style={{ fontWeight: 700, color: toneColor(tone), fontSize: 15 }}>
        {fmtScore(value)}
        <span
          style={{
            color: "var(--color-text-3)",
            fontWeight: 400,
            fontSize: 12,
          }}
        >
          /10
        </span>
      </span>
    </span>
  );
}

function MissingNote({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "16px 0 0",
        padding: "12px 16px",
        borderRadius: 12,
        background: "var(--color-bg-3)",
        border: "1px dashed var(--color-border)",
        color: "var(--color-text-2)",
        fontFamily: "var(--font-landing-body)",
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      {children}
    </p>
  );
}

function SectionHeading({
  eyebrow,
  title,
  emphasis,
  intro,
}: {
  eyebrow?: string;
  title: string;
  emphasis?: string;
  intro?: string;
}) {
  return (
    <div style={{ maxWidth: 760 }}>
      {eyebrow ? (
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--color-coral)",
          }}
        >
          {eyebrow}
        </p>
      ) : null}
      <h2
        style={{
          margin: "10px 0 0",
          fontFamily: "var(--font-landing-head)",
          fontSize: "clamp(28px, 4.4vw, 44px)",
          fontWeight: 600,
          lineHeight: 1.08,
          letterSpacing: "-0.01em",
          color: "var(--color-text)",
        }}
      >
        {title}{" "}
        {emphasis ? (
          <em style={{ fontStyle: "italic", color: "var(--color-coral)" }}>
            {emphasis}
          </em>
        ) : null}
      </h2>
      {intro ? (
        <p
          style={{
            margin: "14px 0 0",
            fontFamily: "var(--font-landing-body)",
            fontSize: 16,
            lineHeight: 1.55,
            color: "var(--color-text-2)",
          }}
        >
          {intro}
        </p>
      ) : null}
    </div>
  );
}

const cardStyle: CSSProperties = {
  background: "var(--color-bg-2)",
  border: "1px solid var(--color-border)",
  borderRadius: 16,
  padding: 22,
};

function sectionStyle(band: "cream" | "white" | "deep"): CSSProperties {
  return {
    background:
      band === "white"
        ? "var(--color-bg-2)"
        : band === "deep"
          ? "var(--color-bg-3)"
          : "var(--color-bg)",
    padding: "clamp(48px, 7vw, 96px) 20px",
  };
}
const container: CSSProperties = { maxWidth: 1120, margin: "0 auto" };

/* -------------------------------------------------------------- CTA button */

function CtaButton({
  href,
  cta,
  variant = "solid",
}: {
  href: string;
  cta: string;
  variant?: "solid" | "light";
}) {
  const solid = variant === "solid";
  return (
    <a
      href={href}
      data-landing-cta={cta}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: 48,
        padding: "0 22px",
        borderRadius: 12,
        background: solid ? "var(--color-coral)" : "#fff",
        color: solid ? "#fff" : "var(--color-coral)",
        border: `1px solid ${solid ? "var(--color-coral)" : "#fff"}`,
        fontFamily: "var(--font-landing-body)",
        fontSize: 15,
        fontWeight: 600,
        textDecoration: "none",
      }}
    >
      Start tracking · $29/mo →
    </a>
  );
}

/* ------------------------------------------------------------------ top bar */

function TopBar({ ctaHref }: { ctaHref: string }) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: "color-mix(in srgb, var(--color-bg) 88%, transparent)",
        backdropFilter: "saturate(140%) blur(8px)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <div
        style={{
          ...container,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 64,
          padding: "0 20px",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-landing-head)",
            fontSize: 22,
            fontWeight: 600,
            color: "var(--color-text)",
            letterSpacing: "-0.01em",
          }}
        >
          mapsly
        </span>
        <CtaButton href={ctaHref} cta="top" />
      </div>
    </header>
  );
}

/* --------------------------------------------------------------------- hero */

function Hero({ data, ctaHref }: { data: LandingData; ctaHref: string }) {
  const addressLine = [data.category, data.address ?? data.city]
    .filter(Boolean)
    .join(" · ");
  const more = estMoreCustomers(data.search);

  return (
    <section
      data-landing-section="hero"
      style={{ ...sectionStyle("cream"), paddingTop: 56 }}
    >
      <div
        style={{
          ...container,
          display: "grid",
          gap: 40,
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(260px, 1fr)",
          alignItems: "center",
        }}
        className="landing-hero-grid"
      >
        <div>
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--color-text-3)",
            }}
          >
            {addressLine || "Local business"}
          </p>
          <h1
            style={{
              margin: "14px 0 0",
              fontFamily: "var(--font-landing-head)",
              fontSize: "clamp(40px, 7vw, 76px)",
              fontWeight: 600,
              lineHeight: 1.02,
              letterSpacing: "-0.02em",
              color: "var(--color-text)",
            }}
          >
            {data.name}
          </h1>
          <p
            style={{
              margin: "20px 0 0",
              maxWidth: 520,
              fontFamily: "var(--font-landing-body)",
              fontSize: 19,
              lineHeight: 1.5,
              color: "var(--color-text-2)",
            }}
          >
            {more
              ? `Win back ${more}+ more customers with Mapsly over the next 3 months — `
              : "See exactly what's working and what's costing you customers — "}
            here&apos;s where you stand against every{" "}
            {data.category.toLowerCase()} near you.
          </p>
          <div style={{ marginTop: 28 }}>
            <CtaButton href={ctaHref} cta="hero" />
          </div>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <div
            style={{
              ...cardStyle,
              display: "flex",
              alignItems: "center",
              gap: 18,
            }}
          >
            <ScoreGauge value={data.mapslyScore} />
            <div>
              <p
                style={{
                  margin: 0,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--color-text-3)",
                }}
              >
                Mapsly score
              </p>
              <p
                style={{
                  margin: "4px 0 0",
                  fontFamily: "var(--font-landing-body)",
                  fontSize: 13,
                  color: "var(--color-text-2)",
                  lineHeight: 1.4,
                }}
              >
                Your overall standing,
                <br />
                0–10
              </p>
            </div>
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
          >
            <div style={cardStyle}>
              <p
                style={{
                  margin: 0,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--color-text-3)",
                }}
              >
                {data.cellLabel ?? "Your market"}
              </p>
              <p
                style={{
                  margin: "8px 0 0",
                  fontFamily: "var(--font-landing-head)",
                  fontSize: 34,
                  fontWeight: 600,
                  color: "var(--color-text)",
                  lineHeight: 1,
                }}
              >
                {rankColumns(data.rank)}
              </p>
              <p
                style={{
                  margin: "4px 0 0",
                  fontFamily: "var(--font-landing-body)",
                  fontSize: 12,
                  color: "var(--color-text-3)",
                }}
              >
                {data.total ? `of ${data.total} nearby` : "ranking soon"}
              </p>
            </div>
            <div style={cardStyle}>
              <p
                style={{
                  margin: 0,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--color-text-3)",
                }}
              >
                Google
              </p>
              <p
                style={{
                  margin: "8px 0 0",
                  fontFamily: "var(--font-landing-head)",
                  fontSize: 34,
                  fontWeight: 600,
                  color: "var(--color-text)",
                  lineHeight: 1,
                }}
              >
                {fmtRating(data.googleRating)}
              </p>
              <p
                style={{
                  margin: "4px 0 0",
                  fontFamily: "var(--font-landing-body)",
                  fontSize: 12,
                  color: "var(--color-text-3)",
                }}
              >
                {data.reviewCount != null
                  ? `${fmtNum(data.reviewCount)} reviews`
                  : "no reviews yet"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- changes section */

function ChangesSection({ events }: { events: SmbMarketChange[] }) {
  return (
    <section data-landing-section="changes" style={sectionStyle("deep")}>
      <div
        style={{
          ...container,
          display: "grid",
          gap: 40,
          gridTemplateColumns: "minmax(0, 1fr) minmax(300px, 1fr)",
          alignItems: "start",
        }}
        className="landing-2col"
      >
        <SectionHeading
          title="What changed in your area"
          emphasis="this week."
          intro="Every week we watch the businesses you compete with — new reviews, rating moves, ads starting and stopping, search positions shifting. Here's what just moved."
        />
        <div style={cardStyle}>
          {events.length === 0 ? (
            <MissingNote>
              We&apos;ll show this week&apos;s market moves here once we&apos;ve
              tracked your area for a full week.
            </MissingNote>
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "grid",
                gap: 12,
              }}
            >
              {events.slice(0, 6).map((e) => (
                <li
                  key={e.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    paddingBottom: 12,
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-landing-body)",
                      fontSize: 14,
                      color: "var(--color-text)",
                      lineHeight: 1.4,
                    }}
                  >
                    {e.body}
                  </span>
                  {e.delta ? (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        fontWeight: 600,
                        color:
                          e.tone === "good"
                            ? "var(--color-success)"
                            : e.tone === "bad"
                              ? "var(--color-coral)"
                              : "var(--color-text-3)",
                      }}
                    >
                      {e.delta}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- search section */

function SearchSection({ search }: { search: LandingSearchData }) {
  return (
    <section data-landing-section="search" style={sectionStyle("white")}>
      <div style={container}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <SectionHeading
            eyebrow="Search · what you offer"
            title="Where you show up when patients"
            emphasis="search Google."
          />
          <ScoreChip value={search.pillar} label="Search" />
        </div>

        {search.hasData ? (
          <div
            style={{
              marginTop: 28,
              ...cardStyle,
              padding: 0,
              overflow: "hidden",
            }}
          >
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>How people search</Th>
                  <Th align="right">Monthly searches</Th>
                  <Th align="right">Your rank</Th>
                  <Th align="right">Customers / mo</Th>
                </tr>
              </thead>
              <tbody>
                {search.topKeywords.map((k) => {
                  const rank = k.organicRank ?? k.mapsRank;
                  return (
                    <tr key={k.keyword}>
                      <Td>{k.keyword}</Td>
                      <Td align="right">{fmtNum(k.volume)}</Td>
                      <Td align="right">
                        {rank != null ? `#${rank}` : "not ranking"}
                      </Td>
                      <Td align="right">
                        {k.estCustomers != null
                          ? `~${fmtNum(k.estCustomers)}`
                          : "—"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <MissingNote>
            We haven&apos;t scanned how you rank on Google yet. Start with
            Mapsly and we&apos;ll map every search patients use to find
            businesses like yours — and exactly where you land.
          </MissingNote>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- ads section */

function AdsSection({ ads }: { ads: LandingAdsData }) {
  return (
    <section data-landing-section="ads" style={sectionStyle("cream")}>
      <div style={container}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <SectionHeading
            eyebrow="Ads · who's paying to win"
            title="Patients search for you. Competitors"
            emphasis="pay to be the answer."
            intro={
              ads.adsApplicable === false
                ? "You're not running ads right now — here's who is, in your area."
                : undefined
            }
          />
          <ScoreChip value={ads.pillar} label="Ads" />
        </div>

        {ads.hasData ? (
          <div
            style={{
              marginTop: 28,
              ...cardStyle,
              padding: 0,
              overflow: "hidden",
            }}
          >
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>Advertiser near you</Th>
                  <Th>Where they run</Th>
                  <Th align="right">Active ads</Th>
                </tr>
              </thead>
              <tbody>
                {ads.competitors.map((c) => (
                  <tr
                    key={c.name}
                    style={
                      c.isOwn ? { background: "var(--color-bg-3)" } : undefined
                    }
                  >
                    <Td>
                      {c.name}
                      {c.isOwn ? <span style={ownTag}>You</span> : null}
                    </Td>
                    <Td>{c.platforms.length ? c.platforms.join(", ") : "—"}</Td>
                    <Td align="right">{fmtNum(c.activeAds)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <MissingNote>
            We haven&apos;t mapped the ads running in your area yet. Mapsly
            tracks every competitor advertising on Google and Meta for your
            services — so you see who&apos;s buying the patients you could win.
          </MissingNote>
        )}
      </div>
    </section>
  );
}

/* --------------------------------------------------------- reviews section */

function ReviewsSection({ reviews }: { reviews: LandingReviewsData }) {
  return (
    <section data-landing-section="reviews" style={sectionStyle("white")}>
      <div style={container}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <SectionHeading
            eyebrow="Reviews · reputation"
            title="What patients praise at the places they"
            emphasis="pick over you."
          />
          <ScoreChip value={reviews.pillar} label="Reviews" />
        </div>

        {reviews.hasData ? (
          <div
            style={{
              marginTop: 28,
              display: "grid",
              gap: 18,
              gridTemplateColumns: "minmax(0, 1.4fr) minmax(220px, 1fr)",
            }}
            className="landing-2col"
          >
            <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <Th>You vs nearby</Th>
                    <Th align="right">Rating</Th>
                    <Th align="right">Reviews</Th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.competitors.map((c) => (
                    <tr
                      key={c.name}
                      style={
                        c.isOwn
                          ? { background: "var(--color-bg-3)" }
                          : undefined
                      }
                    >
                      <Td>
                        {c.name}
                        {c.isOwn ? <span style={ownTag}>You</span> : null}
                      </Td>
                      <Td align="right">{fmtRating(c.rating)}</Td>
                      <Td align="right">{fmtNum(c.reviewCount)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={cardStyle}>
              <p style={statLabel}>You reply to</p>
              <p style={statBig}>{fmtPct(reviews.replyRate)}</p>
              <p style={{ ...statSub, marginBottom: 16 }}>
                of reviews
                {reviews.unanswered > 0
                  ? ` · ${reviews.unanswered} waiting`
                  : ""}
              </p>
              {reviews.themes.length > 0 ? (
                <>
                  <p style={statLabel}>Patients mention</p>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      marginTop: 8,
                    }}
                  >
                    {reviews.themes.map((t) => (
                      <span key={t.label} style={themeChip}>
                        {t.label} · {t.count}
                      </span>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : (
          <MissingNote>
            We haven&apos;t pulled your reviews yet. Mapsly reads every review
            you and your competitors get — what patients praise, what they
            complain about, and how fast owners reply.
          </MissingNote>
        )}
      </div>
    </section>
  );
}

/* --------------------------------------------------------- website section */

function WebsiteSection({ website }: { website: LandingWebsiteData }) {
  return (
    <section data-landing-section="website" style={sectionStyle("cream")}>
      <div style={container}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <SectionHeading
            eyebrow="Website · 12 checks"
            title="Your website, graded on the things"
            emphasis="patients notice."
            intro={
              website.hasData
                ? `${website.passCount} of ${website.totalChecks} checks passing. Here's what's costing you bookings.`
                : undefined
            }
          />
          <ScoreChip value={website.pillar} label="Website" />
        </div>

        {website.hasData ? (
          <div
            style={{
              marginTop: 28,
              display: "grid",
              gap: 18,
              gridTemplateColumns: "minmax(220px, 1fr) minmax(0, 1.6fr)",
            }}
            className="landing-2col"
          >
            <div style={cardStyle}>
              <p style={statLabel}>Speed score</p>
              <p
                style={{
                  ...statBig,
                  color: toneColor(
                    scoreTone(
                      website.performance != null
                        ? website.performance / 10
                        : null,
                    ),
                  ),
                }}
              >
                {website.performance != null
                  ? Math.round(website.performance)
                  : "—"}
              </p>
              <p style={statSub}>out of 100 on phones</p>
              <p style={{ ...statLabel, marginTop: 16 }}>Found on Google</p>
              <p style={statBig}>
                {website.seo != null ? Math.round(website.seo) : "—"}
              </p>
              <p style={statSub}>SEO health</p>
            </div>
            <div
              style={{
                ...cardStyle,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "10px 18px",
              }}
            >
              {website.checks.map((c) => (
                <div
                  key={c.key}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <CheckMark pass={c.pass} />
                  <span
                    style={{
                      fontFamily: "var(--font-landing-body)",
                      fontSize: 13.5,
                      color:
                        c.pass === false
                          ? "var(--color-text)"
                          : "var(--color-text-2)",
                    }}
                  >
                    {c.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <MissingNote>
            We haven&apos;t audited your website yet. Mapsly checks it against
            the 12 things patients (and Google) notice — speed, booking buttons,
            mobile, and more — every week.
          </MissingNote>
        )}
      </div>
    </section>
  );
}

function CheckMark({ pass }: { pass: boolean | null }) {
  const color =
    pass === true
      ? "var(--color-success)"
      : pass === false
        ? "var(--color-coral)"
        : "var(--color-text-3)";
  const glyph = pass === true ? "✓" : pass === false ? "✕" : "·";
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: 20,
        height: 20,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: "color-mix(in srgb, " + color + " 14%, transparent)",
        color,
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {glyph}
    </span>
  );
}

/* ----------------------------------------------------------- fixes section */

function FixesSection({
  fixes,
  ctaHref,
}: {
  fixes: SmbOverviewFix[];
  ctaHref: string;
}) {
  const top = fixes.slice(0, 3);
  return (
    <section data-landing-section="fixes" style={sectionStyle("deep")}>
      <div style={{ ...container, textAlign: "center" }}>
        <div style={{ display: "inline-block", textAlign: "left" }}>
          <SectionHeading
            title="Where you stand. What to fix."
            emphasis="What changes."
          />
        </div>
        {top.length > 0 ? (
          <div
            style={{
              marginTop: 32,
              display: "grid",
              gap: 18,
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              textAlign: "left",
            }}
          >
            {top.map((f) => (
              <div
                key={f.rank}
                style={{
                  ...cardStyle,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-landing-body)",
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--color-text)",
                    lineHeight: 1.35,
                  }}
                >
                  {f.action}
                </p>
                {f.meta ? (
                  <p
                    style={{
                      margin: 0,
                      fontFamily: "var(--font-landing-body)",
                      fontSize: 13,
                      color: "var(--color-text-3)",
                    }}
                  >
                    {f.meta}
                  </p>
                ) : null}
                <p
                  style={{
                    marginTop: "auto",
                    fontFamily: "var(--font-landing-head)",
                    fontSize: 22,
                    fontWeight: 600,
                    color:
                      f.tone === "good"
                        ? "var(--color-success)"
                        : "var(--color-coral)",
                  }}
                >
                  {f.impact}{" "}
                  <span
                    style={{
                      fontFamily: "var(--font-landing-body)",
                      fontSize: 12,
                      fontWeight: 400,
                      color: "var(--color-text-3)",
                    }}
                  >
                    {f.impactSub}
                  </span>
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 24 }}>
            <MissingNote>
              Once we&apos;ve tracked a full week we&apos;ll line up your
              highest-impact fixes here, in order.
            </MissingNote>
          </div>
        )}
        <div style={{ marginTop: 32 }}>
          <CtaButton href={ctaHref} cta="fixes" />
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- pricing section */

function PricingSection({ ctaHref }: { ctaHref: string }) {
  const props = [
    "Every week: reviews, search, ads, website, competitors — in plain English",
    "Your top 3 fixes, ranked by how many customers they win back",
    "AI-drafted review replies you post in one click",
    "See the moment a competitor starts ads or a rating slips",
  ];
  return (
    <section
      data-landing-section="pricing"
      style={{
        background: "var(--color-coral)",
        padding: "clamp(48px, 7vw, 96px) 20px",
      }}
    >
      <div
        style={{
          ...container,
          display: "grid",
          gap: 40,
          gridTemplateColumns: "minmax(0, 1.3fr) minmax(280px, 1fr)",
          alignItems: "center",
        }}
        className="landing-2col"
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-landing-head)",
              fontSize: "clamp(30px, 4.6vw, 48px)",
              fontWeight: 600,
              lineHeight: 1.06,
              color: "#fff",
            }}
          >
            More patients. Fewer surprises.{" "}
            <em style={{ fontStyle: "italic" }}>$29 a month.</em>
          </h2>
          <ul
            style={{
              listStyle: "none",
              margin: "24px 0 0",
              padding: 0,
              display: "grid",
              gap: 12,
            }}
          >
            {props.map((p) => (
              <li
                key={p}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  color: "rgba(255,255,255,0.94)",
                  fontFamily: "var(--font-landing-body)",
                  fontSize: 15.5,
                  lineHeight: 1.45,
                }}
              >
                <span aria-hidden style={{ color: "#fff", fontWeight: 700 }}>
                  ✓
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            padding: 28,
            textAlign: "center",
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--color-text-3)",
            }}
          >
            Mapsly Pro
          </p>
          <p
            style={{
              margin: "12px 0 0",
              fontFamily: "var(--font-landing-head)",
              fontSize: 56,
              fontWeight: 600,
              color: "var(--color-text)",
              lineHeight: 1,
            }}
          >
            $29
            <span
              style={{
                fontFamily: "var(--font-landing-body)",
                fontSize: 16,
                fontWeight: 400,
                color: "var(--color-text-3)",
              }}
            >
              /mo
            </span>
          </p>
          <p
            style={{
              margin: "8px 0 22px",
              fontFamily: "var(--font-landing-body)",
              fontSize: 13,
              color: "var(--color-text-2)",
            }}
          >
            Cancel anytime. No setup fee.
          </p>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <CtaButton href={ctaHref} cta="pricing" />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ footer */

function Footer() {
  return (
    <footer
      style={{
        background: "var(--color-bg)",
        borderTop: "1px solid var(--color-border)",
        padding: "28px 20px",
      }}
    >
      <div
        style={{
          ...container,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-landing-head)",
            fontSize: 18,
            fontWeight: 600,
            color: "var(--color-text)",
          }}
        >
          mapsly
        </span>
        <span
          style={{
            fontFamily: "var(--font-landing-body)",
            fontSize: 13,
            color: "var(--color-text-3)",
          }}
        >
          Local business intelligence · refreshed weekly
        </span>
      </div>
    </footer>
  );
}

/* ----------------------------------------------------------- shared styles */

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontFamily: "var(--font-landing-body)",
};
function Th({ children, align }: { children: ReactNode; align?: "right" }) {
  return (
    <th
      style={{
        textAlign: align ?? "left",
        padding: "12px 16px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "var(--color-text-3)",
        borderBottom: "1px solid var(--color-border)",
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, align }: { children: ReactNode; align?: "right" }) {
  return (
    <td
      style={{
        textAlign: align ?? "left",
        padding: "12px 16px",
        fontSize: 14,
        color: "var(--color-text)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {children}
    </td>
  );
}
const ownTag: CSSProperties = {
  marginLeft: 8,
  padding: "1px 7px",
  borderRadius: 6,
  background: "var(--color-coral)",
  color: "#fff",
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
const themeChip: CSSProperties = {
  padding: "3px 10px",
  borderRadius: 999,
  background: "var(--color-bg-3)",
  border: "1px solid var(--color-border)",
  fontSize: 12,
  color: "var(--color-text-2)",
};
const statLabel: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--color-text-3)",
};
const statBig: CSSProperties = {
  margin: "6px 0 0",
  fontFamily: "var(--font-landing-head)",
  fontSize: 40,
  fontWeight: 600,
  color: "var(--color-text)",
  lineHeight: 1,
};
const statSub: CSSProperties = {
  margin: "4px 0 0",
  fontFamily: "var(--font-landing-body)",
  fontSize: 12,
  color: "var(--color-text-3)",
};

/* ------------------------------------------------------------------- view */

export function LandingView({ data }: { data: LandingData }) {
  const ctaHref = `/signin?intent=smb&landing=${encodeURIComponent(data.token)}`;
  return (
    <main
      style={{
        background: "var(--color-bg)",
        fontFamily: "var(--font-landing-body)",
      }}
    >
      <LandingAnalytics token={data.token} />
      <TopBar ctaHref={ctaHref} />
      <Hero data={data} ctaHref={ctaHref} />
      <ChangesSection events={data.events} />
      <SearchSection search={data.search} />
      <AdsSection ads={data.adsDetail} />
      <ReviewsSection reviews={data.reviews} />
      <WebsiteSection website={data.websiteDetail} />
      <FixesSection fixes={data.fixes} ctaHref={ctaHref} />
      <PricingSection ctaHref={ctaHref} />
      <Footer />
    </main>
  );
}
