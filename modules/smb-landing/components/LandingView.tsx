/**
 * Public landing page view (`/l/[slug]-[token]`).
 *
 * A personalized, single-scroll proposal assembled from the business's REAL
 * latest snapshot + market-cell data — the surface we email a qualified SMB to
 * convert them into a $29/mo subscriber. Recreated block-by-block from the
 * design: centered eyebrow + coral-italic serif headings, a hero score panel,
 * a "what changed this week" card, per-section blocks (search / ads / reviews /
 * website) each with a market-relative "problem → solution" callout, ranked
 * fixes, and the $29 band.
 *
 * Server component · inline styles + CSS vars per the marketing convention.
 * `data-landing-section` / `data-landing-cta` hooks let the client analytics
 * layer (LandingAnalytics) observe scroll-depth + clicks. Honest "we don't
 * track this yet" notes stand in for any missing section.
 *
 * Per `.claude/rules/ui-ux-smb.md`: warm, plain English, Maria's vocabulary,
 * one clear action (Start tracking · $29/mo). Headline copy is template-level
 * (to be reworked) — the DATA is real.
 */

import type { CSSProperties, ReactNode } from "react";

import type { SmbOverviewFix } from "@/modules/smb-home/types";
import type {
  LandingAdsData,
  LandingChange,
  LandingData,
  LandingGap,
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
/* ----------------------------------------------------------- layout tokens */

const PAGE: CSSProperties = {
  background: "var(--color-bg)",
  fontFamily: "var(--font-landing-body)",
  color: "var(--color-text)",
};
const CONTAINER: CSSProperties = { maxWidth: 1140, margin: "0 auto" };
const CARD: CSSProperties = {
  background: "var(--color-bg-2)",
  border: "1px solid var(--color-border)",
  borderRadius: 18,
  padding: 24,
};
function sectionStyle(band: "cream" | "white" | "deep"): CSSProperties {
  return {
    background:
      band === "white"
        ? "var(--color-bg-2)"
        : band === "deep"
          ? "var(--color-bg-3)"
          : "var(--color-bg)",
    padding: "clamp(56px, 8vw, 104px) 20px",
  };
}
const SERIF = "var(--font-landing-head)";
const MONO = "var(--font-mono)";

/* -------------------------------------------------------------- primitives */

/** Centered eyebrow + serif heading (with coral-italic emphasis) + subhead. */
function SectionIntro({
  eyebrow,
  title,
  emphasis,
  suffix,
  intro,
}: {
  eyebrow: string;
  title: string;
  emphasis: string;
  suffix?: string;
  intro?: string;
}) {
  return (
    <div style={{ textAlign: "center", maxWidth: 820, margin: "0 auto" }}>
      <p
        style={{
          margin: 0,
          fontFamily: MONO,
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--color-coral)",
        }}
      >
        {eyebrow}
      </p>
      <h2
        style={{
          margin: "16px 0 0",
          fontFamily: SERIF,
          fontSize: "clamp(36px, 5.4vw, 64px)",
          fontWeight: 600,
          lineHeight: 1.05,
          letterSpacing: "-0.015em",
          color: "var(--color-text)",
        }}
      >
        {title}{" "}
        <em style={{ fontStyle: "italic", color: "var(--color-coral)" }}>
          {emphasis}
        </em>
        {suffix ? <span> {suffix}</span> : null}
      </h2>
      {intro ? (
        <p
          style={{
            margin: "20px auto 0",
            maxWidth: 720,
            fontFamily: "var(--font-landing-body)",
            fontSize: 17,
            lineHeight: 1.6,
            color: "var(--color-text-3)",
          }}
        >
          {intro}
        </p>
      ) : null}
    </div>
  );
}

/** "● Mapsly score: X.X /10" line. */
function ScoreLine({ value }: { value: number | null }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        fontFamily: "var(--font-landing-body)",
        fontSize: 16,
        color: "var(--color-text-2)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: "var(--color-gold-2)",
          display: "inline-block",
        }}
      />
      Mapsly score:{" "}
      <strong
        style={{ fontFamily: SERIF, fontSize: 22, color: "var(--color-text)" }}
      >
        {fmtScore(value)}
      </strong>
      <span style={{ color: "var(--color-text-3)", fontSize: 13 }}>/10</span>
    </div>
  );
}

function CtaPill({
  href,
  cta,
  label,
  variant = "solid",
}: {
  href: string;
  cta: string;
  label: string;
  variant?: "solid" | "outline" | "light";
}) {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    height: 52,
    padding: "0 26px",
    borderRadius: 999,
    fontFamily: "var(--font-landing-body)",
    fontSize: 15,
    fontWeight: 600,
    textDecoration: "none",
    whiteSpace: "nowrap",
  };
  const style: CSSProperties =
    variant === "solid"
      ? {
          ...base,
          background: "var(--color-coral)",
          color: "#fff",
          border: "1px solid var(--color-coral)",
        }
      : variant === "light"
        ? {
            ...base,
            background: "#fff",
            color: "var(--color-coral)",
            border: "1px solid #fff",
          }
        : {
            ...base,
            background: "transparent",
            color: "var(--color-coral)",
            border: "1px solid var(--color-coral)",
          };
  return (
    <a href={href} data-landing-cta={cta} style={style}>
      {label} <span aria-hidden>→</span>
    </a>
  );
}

/** "Your problem → Your solution" two-box callout. */
function ProblemSolution({ gap }: { gap: LandingGap }) {
  const box: CSSProperties = {
    flex: "1 1 320px",
    background: "var(--color-bg-3)",
    borderRadius: 14,
    padding: "16px 20px",
    fontSize: 14.5,
    lineHeight: 1.5,
    color: "var(--color-text-2)",
  };
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "stretch",
        gap: 16,
        marginTop: 28,
      }}
    >
      <div style={box}>
        <strong style={{ color: "var(--color-coral)" }}>Your problem:</strong>{" "}
        {gap.problem}
      </div>
      <div
        style={{
          display: "grid",
          placeItems: "center",
          color: "var(--color-gold)",
          fontSize: 22,
        }}
        aria-hidden
      >
        →
      </div>
      <div style={box}>
        <strong style={{ color: "var(--color-success)" }}>
          Your solution:
        </strong>{" "}
        {gap.solution}
      </div>
    </div>
  );
}

function MissingNote({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "20px auto 0",
        maxWidth: 640,
        padding: "14px 18px",
        borderRadius: 14,
        background: "var(--color-bg-3)",
        border: "1px dashed var(--color-border)",
        color: "var(--color-text-2)",
        fontFamily: "var(--font-landing-body)",
        fontSize: 14.5,
        lineHeight: 1.55,
        textAlign: "center",
      }}
    >
      {children}
    </p>
  );
}

function Stars({ value }: { value: number | null }) {
  const n = value == null ? 0 : Math.round(value);
  return (
    <span
      aria-hidden
      style={{ color: "var(--color-gold)", letterSpacing: 1, fontSize: 16 }}
    >
      {"★".repeat(Math.min(5, n))}
      <span style={{ color: "var(--color-border)" }}>
        {"★".repeat(Math.max(0, 5 - n))}
      </span>
    </span>
  );
}

function ScoreGauge({ value }: { value: number | null }) {
  const r = 50;
  const C = 2 * Math.PI * r;
  const arc = 0.75 * C; // 270° open-bottom sweep
  const frac = value == null ? 0 : Math.max(0, Math.min(1, value / 10));
  return (
    <div
      role="img"
      aria-label={
        value == null ? "Not scored yet" : `${value.toFixed(1)} out of 10`
      }
      style={{ position: "relative", width: 156, height: 138 }}
    >
      <svg
        viewBox="0 0 120 120"
        width="156"
        height="156"
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="var(--color-bg-3)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={`${arc} ${C}`}
          transform="rotate(135 60 60)"
        />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="#ecc94b"
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={`${arc * frac} ${C}`}
          transform="rotate(135 60 60)"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 130,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontFamily: SERIF,
            fontSize: 44,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {fmtScore(value)}
        </span>
        <span
          style={{ fontSize: 13, color: "var(--color-text-3)", marginTop: 2 }}
        >
          /10
        </span>
      </div>
    </div>
  );
}

function CurlyArrow({ color = "#fff" }: { color?: string }) {
  return (
    <svg
      width="150"
      height="92"
      viewBox="0 0 180 110"
      fill="none"
      aria-hidden
      style={{ color }}
    >
      <path
        d="M10 66C46 94 102 92 132 64c20-18 11-42-8-35-13 5-7 28 19 25 16-2 27-11 35-23"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M178 31l-13 4m13-4l-3 13"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function RankBadge({ rank, isOwn }: { rank: number; isOwn?: boolean }) {
  const bg = isOwn
    ? "var(--color-coral)"
    : rank === 1
      ? "var(--color-success)"
      : "var(--color-gold)";
  return (
    <span
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: 22,
        height: 22,
        borderRadius: "50%",
        background: bg,
        color: "#fff",
        fontSize: 11,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {rank}
    </span>
  );
}

/* table primitives */
const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontFamily: "var(--font-landing-body)",
};
function Th({
  children,
  align,
}: {
  children: ReactNode;
  align?: "right" | "center";
}) {
  return (
    <th
      style={{
        textAlign: align ?? "left",
        padding: "10px 14px",
        fontFamily: MONO,
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "var(--color-text-3)",
        borderBottom: "1px solid var(--color-border)",
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}
function Td({
  children,
  align,
  color,
}: {
  children: ReactNode;
  align?: "right" | "center";
  color?: string;
}) {
  return (
    <td
      style={{
        textAlign: align ?? "left",
        padding: "12px 14px",
        fontSize: 14,
        color: color ?? "var(--color-text)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {children}
    </td>
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
        background: "color-mix(in srgb, var(--color-bg) 90%, transparent)",
        backdropFilter: "saturate(140%) blur(8px)",
      }}
    >
      <div
        style={{
          ...CONTAINER,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 66,
          padding: "0 20px",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 22 }}>
          <Wordmark />
          <Tagline />
        </span>
        <CtaPill href={ctaHref} cta="top" label="Start tracking · $29/mo" />
      </div>
    </header>
  );
}

function Wordmark({ light }: { light?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        fontFamily: SERIF,
        fontSize: 26,
        fontWeight: 700,
        letterSpacing: "-0.01em",
        color: light ? "#fff" : "var(--color-text)",
      }}
    >
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden>
        <rect
          x="4"
          y="3"
          width="24"
          height="24"
          rx="8"
          fill={light ? "#fff" : "var(--color-coral)"}
        />
        <path
          d="M16 9c-2.8 0-5 2.2-5 5 0 3.6 5 8.2 5 8.2s5-4.6 5-8.2c0-2.8-2.2-5-5-5Z"
          fill={light ? "var(--color-coral)" : "#fff"}
        />
        <circle
          cx="16"
          cy="14"
          r="1.8"
          fill={light ? "#fff" : "var(--color-coral)"}
        />
      </svg>
      mapsly
    </span>
  );
}

function Tagline({ light }: { light?: boolean }) {
  return (
    <span
      className="landing-tagline"
      style={{
        fontFamily: SERIF,
        fontSize: 18,
        fontWeight: 700,
        color: light ? "rgba(255,255,255,0.92)" : "var(--color-text)",
        whiteSpace: "nowrap",
      }}
    >
      Your business.{" "}
      <em
        style={{
          fontStyle: "italic",
          fontWeight: 600,
          color: light ? "rgba(255,255,255,0.85)" : "var(--color-coral)",
        }}
      >
        Mapped.
      </em>
    </span>
  );
}

const heroCard: CSSProperties = {
  position: "absolute",
  background: "#fff",
  borderRadius: 22,
  padding: "26px 22px",
  boxShadow:
    "0 24px 60px -28px rgba(28,25,22,0.28), 0 3px 10px rgba(28,25,22,0.05)",
};
const heroCardTitle: CSSProperties = {
  margin: 0,
  fontFamily: SERIF,
  fontSize: 27,
  fontWeight: 700,
  color: "var(--color-text)",
};
const heroCardSub: CSSProperties = {
  margin: "8px 0 0",
  fontSize: 13.5,
  color: "var(--color-text-3)",
  lineHeight: 1.45,
};

/* --------------------------------------------------------------------- hero */

function Hero({ data }: { data: LandingData }) {
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
        background:
          "radial-gradient(58% 52% at 80% 38%, color-mix(in srgb, var(--color-coral) 9%, transparent), transparent 70%), var(--color-bg)",
        padding: "clamp(20px, 3vw, 40px) 20px clamp(36px, 5vw, 64px)",
        overflow: "hidden",
      }}
    >
      <div
        className="landing-hero-grid"
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          display: "grid",
          gap: 40,
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.08fr)",
          alignItems: "center",
        }}
      >
        <div>
          <p
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              margin: 0,
              fontSize: 15,
              color: "var(--color-text-3)",
            }}
          >
            <span
              aria-hidden
              style={{ color: "var(--color-coral)", fontWeight: 700 }}
            >
              ✓
            </span>
            <span style={{ color: "var(--color-text-2)" }}>{cat}</span>
            <span aria-hidden style={{ color: "var(--color-border)" }}>
              •
            </span>
            <span>{addr}</span>
          </p>
          <h1
            style={{
              margin: "26px 0 0",
              fontFamily: SERIF,
              fontSize: "clamp(48px, 8vw, 100px)",
              fontWeight: 700,
              lineHeight: 1.02,
              letterSpacing: "-0.02em",
              color: "var(--color-text)",
              textDecorationLine: "underline",
              textDecorationColor: "var(--color-coral)",
              textDecorationThickness: "6px",
              textUnderlineOffset: "0.16em",
            }}
          >
            {data.name}
          </h1>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 18,
              marginTop: 44,
              maxWidth: 520,
            }}
          >
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: 44,
                height: 2,
                background: "var(--color-coral)",
                marginTop: 17,
              }}
            />
            <p
              style={{
                margin: 0,
                fontSize: 23,
                lineHeight: 1.45,
                color: "var(--color-text)",
              }}
            >
              Get up to{" "}
              <em
                style={{
                  fontFamily: SERIF,
                  fontStyle: "italic",
                  fontWeight: 600,
                  color: "var(--color-coral)",
                }}
              >
                30% more customers
              </em>
              <span
                style={{
                  display: "block",
                  marginTop: 4,
                  fontSize: 19,
                  color: "var(--color-text-2)",
                }}
              >
                with Mapsly in the next 3 months
              </span>
            </p>
          </div>
        </div>

        <div className="landing-hero-cards">
          <div
            className="hero-card-1"
            style={{
              ...heroCard,
              top: 0,
              left: 0,
              width: "52%",
              textAlign: "center",
            }}
          >
            <p style={heroCardTitle}>Mapsly score</p>
            <p style={heroCardSub}>your visibility to customers</p>
            <div
              style={{
                marginTop: 12,
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
              top: 52,
              right: 0,
              width: "46%",
              textAlign: "center",
            }}
          >
            <p style={heroCardTitle}>{data.cellLabel ?? "Your market"}</p>
            <p
              style={{
                margin: "16px 0 0",
                fontFamily: SERIF,
                fontWeight: 700,
                fontSize: 64,
                lineHeight: 1,
              }}
            >
              {data.rank ?? "—"}
              {data.total != null ? (
                <span
                  style={{
                    fontSize: 20,
                    fontWeight: 400,
                    color: "var(--color-text-3)",
                  }}
                >
                  {" "}
                  /{data.total}
                </span>
              ) : null}
            </p>
            <p style={{ ...heroCardSub, marginTop: 16 }}>
              Your position across all {cat}s in {data.cellLabel ?? "your area"}
            </p>
          </div>
          <div
            className="hero-card-3"
            style={{
              ...heroCard,
              top: 332,
              left: "25%",
              width: "50%",
              textAlign: "center",
            }}
          >
            <p style={heroCardTitle}>Google</p>
            <p
              style={{
                margin: "12px 0 0",
                fontFamily: SERIF,
                fontWeight: 700,
                fontSize: 52,
                lineHeight: 1,
              }}
            >
              {fmtRating(data.googleRating)}
            </p>
            <div style={{ marginTop: 8 }}>
              <Stars value={data.googleRating} />
            </div>
            <p style={{ ...heroCardSub, marginTop: 10 }}>
              {fmtNum(data.reviewCount)} reviews
            </p>
            {trend > 0 ? (
              <p
                style={{
                  margin: "8px 0 0",
                  color: "var(--color-success)",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                ↗ +{trend} this month
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div style={{ textAlign: "center", marginTop: 24 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-3)" }}>
          more info
        </p>
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          style={{ marginTop: 2, color: "var(--color-coral)" }}
        >
          <path
            d="M5 7l7 6 7-6M5 13l7 6 7-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- changes section */

function ChangesSection({ changes }: { changes: LandingChange[] }) {
  return (
    <section
      data-landing-section="changes"
      style={{ background: "#e9e2d7", padding: "clamp(56px, 8vw, 104px) 20px" }}
    >
      <div
        className="landing-2col"
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          display: "grid",
          gap: 56,
          gridTemplateColumns: "minmax(0, 1fr) minmax(330px, 0.82fr)",
          alignItems: "start",
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontFamily: MONO,
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "0.02em",
              color: "var(--color-coral)",
            }}
          >
            This week in your market
          </p>
          <h2
            style={{
              margin: "20px 0 0",
              fontFamily: SERIF,
              fontSize: "clamp(40px, 5.6vw, 72px)",
              fontWeight: 700,
              lineHeight: 1.02,
              letterSpacing: "-0.02em",
              color: "var(--color-text)",
            }}
          >
            What changed in your area{" "}
            <em
              style={{
                fontStyle: "italic",
                fontWeight: 600,
                color: "var(--color-coral)",
              }}
            >
              this week.
            </em>
          </h2>
          <p
            style={{
              margin: "26px 0 0",
              maxWidth: 470,
              fontSize: 18,
              lineHeight: 1.6,
              color: "var(--color-text-3)",
            }}
          >
            Weekly digest of every verified move your competitors made — new
            reviews, new ads, ranking shifts, photo uploads. Refreshes every
            Monday with Pro.
          </p>
          <div
            className="landing-changes-arrow"
            style={{ marginTop: 28, paddingLeft: "42%" }}
          >
            <CurlyArrow />
          </div>
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          {changes.map((c) => (
            <ChangeCard key={c.id} c={c} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ChangeCard({ c }: { c: LandingChange }) {
  const barHex =
    c.barColor === "gold"
      ? "#e7c24c"
      : c.barColor === "coral"
        ? "var(--color-coral)"
        : "#a7b88c";
  return (
    <div
      style={{
        background: "#fbf9f5",
        borderRadius: 20,
        padding: "20px 24px",
        boxShadow: c.faded ? "none" : "0 16px 40px -24px rgba(28,25,22,0.22)",
        opacity: c.faded ? 0.45 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span
          style={{
            fontSize: 16.5,
            fontWeight: 700,
            color: "var(--color-text)",
          }}
        >
          {c.title}
        </span>
        <span
          style={{ fontSize: 13, color: "var(--color-text-3)", flexShrink: 0 }}
        >
          {c.meta}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 14,
        }}
      >
        <span
          style={{ display: "inline-flex", alignItems: "baseline", gap: 10 }}
        >
          <span
            style={{
              fontFamily: SERIF,
              fontSize: 46,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            {c.value}
          </span>
          <span style={{ fontSize: 19, color: "var(--color-text-2)" }}>
            {c.valueSuffix}
          </span>
        </span>
        {c.stars != null ? <Stars value={c.stars} /> : null}
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 999,
          background: "rgba(28,25,22,0.1)",
          marginTop: 16,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.max(0, Math.min(100, c.barPct))}%`,
            height: "100%",
            borderRadius: 999,
            background: barHex,
          }}
        />
      </div>
      <p
        style={{
          margin: "16px 0 0",
          fontSize: 13.5,
          lineHeight: 1.5,
          color: "var(--color-text-3)",
        }}
      >
        {c.desc}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------- search section */

function SearchSection({
  search,
  gap,
  category,
  ctaHref,
}: {
  search: LandingSearchData;
  gap: LandingGap | null;
  category: string;
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
          eyebrow="What you sell? Where Google shows you?"
          title="What you offer."
          emphasis="Where you show up on Google."
          intro="Every service you offer matched against monthly Google searches in your area, and where you currently rank."
        />

        {search.hasData ? (
          <div
            className="landing-2col"
            style={{
              marginTop: 44,
              display: "grid",
              gap: 32,
              gridTemplateColumns: "minmax(300px, 0.82fr) minmax(0, 1.45fr)",
              alignItems: "start",
            }}
          >
            {/* LEFT · stat card */}
            <div
              style={{
                background: "var(--color-bg-3)",
                borderRadius: 22,
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
                    fontSize: 21,
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
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 20,
                  marginTop: 26,
                }}
              >
                <div>
                  <p style={statCardLabel}>monthly Google searches:</p>
                  <p style={statCardBig}>
                    {total != null ? fmtNum(total) : "—"}
                    <span style={statCardUnit}> /mo</span>
                  </p>
                </div>
                <div>
                  <p style={statCardLabel}>Searches you show up only:</p>
                  <p style={{ ...statCardBig, color: "var(--color-coral)" }}>
                    {youGet != null ? fmtNum(youGet) : "—"}
                    <span style={statCardUnit}> /mo</span>
                  </p>
                </div>
              </div>
              {youGet != null && others != null ? (
                <p
                  style={{
                    margin: "24px 0 0",
                    fontSize: 15,
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
              <p
                style={{
                  margin: "16px 0 0",
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "var(--color-text-3)",
                }}
              >
                These are the searches your future patients run — Mapsly tracks
                your position on every one, every week.
              </p>
              <div style={{ marginTop: 18 }}>
                <ScoreLine value={search.pillar} />
              </div>
              <div style={{ marginTop: 18 }}>
                <CtaPill
                  href={ctaHref}
                  cta="search"
                  label="Get map visibility"
                />
              </div>
            </div>

            {/* RIGHT · keyword table */}
            <div>
              <p
                style={{
                  margin: "4px 0 0",
                  fontFamily: SERIF,
                  fontSize: 22,
                  fontWeight: 700,
                }}
              >
                How do people search for you on Google?
              </p>
              <div style={{ position: "relative", marginTop: 14 }}>
                <div style={{ maxHeight: 440, overflow: "hidden" }}>
                  <table style={tableStyle}>
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
                              <span style={{ fontWeight: 600 }}>
                                {k.service}
                              </span>
                            </Td>
                            <Td color="var(--color-text-3)">{`"${k.keyword}"`}</Td>
                            <Td align="right">{fmtNum(k.volume)}</Td>
                            <Td align="right" color={rate.color}>
                              {rate.label}
                              {rate.ok ? " ✓" : ""}
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
            </div>
          </div>
        ) : (
          <MissingNote>
            {
              "We haven't scanned how you rank on Google yet. Start with Mapsly and we'll map every search patients use to find businesses like yours — and exactly where you land."
            }
          </MissingNote>
        )}

        {gap ? <ProblemSolution gap={gap} /> : null}
      </div>
    </section>
  );
}

/** Multi-color Google wordmark. */
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
        fontWeight: 500,
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
  fontSize: 14,
  color: "var(--color-text-2)",
  lineHeight: 1.3,
};
const statCardBig: CSSProperties = {
  margin: "8px 0 0",
  fontFamily: SERIF,
  fontSize: 44,
  fontWeight: 700,
  lineHeight: 1,
  color: "var(--color-text)",
};
const statCardUnit: CSSProperties = {
  fontFamily: "var(--font-landing-body)",
  fontSize: 15,
  fontWeight: 400,
  color: "var(--color-text-3)",
};

/* ------------------------------------------------------------- ads section */

function AdsSection({
  ads,
  gap,
  name,
  ctaHref,
}: {
  ads: LandingAdsData;
  gap: LandingGap | null;
  name: string;
  ctaHref: string;
}) {
  return (
    <section data-landing-section="ads" style={sectionStyle("cream")}>
      <div style={CONTAINER}>
        <SectionIntro
          eyebrow="Who's running ads against you?"
          title="Patients search for your services."
          emphasis="Three competitors pay to be the answer."
          intro="We scan Meta Ad Library + Google Ads Transparency Center for every advertiser bidding on your services or your brand name in your market. You're not running ads — they are."
        />

        {ads.hasData ? (
          <>
            <div
              className="landing-2col"
              style={{
                marginTop: 44,
                display: "grid",
                gap: 40,
                gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 0.95fr)",
                alignItems: "start",
              }}
            >
              <div>
                <p
                  style={{
                    margin: 0,
                    fontFamily: SERIF,
                    fontSize: 24,
                    fontWeight: 700,
                  }}
                >
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
              {gap ? <ProblemSolutionStacked gap={gap} /> : <div />}
            </div>

            <div style={{ marginTop: 52 }}>
              <p
                style={{
                  margin: 0,
                  fontFamily: SERIF,
                  fontSize: 24,
                  fontWeight: 700,
                }}
              >
                Ads running near you:
              </p>
              <table style={{ ...tableStyle, marginTop: 16 }}>
                <thead>
                  <tr>
                    <Th>Advertiser near you</Th>
                    <Th align="right">Active ads</Th>
                    <Th>Where</Th>
                    <Th align="right">Yours?</Th>
                  </tr>
                </thead>
                <tbody>
                  {ads.competitors.map((c) => (
                    <tr key={c.name}>
                      <Td>
                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                      </Td>
                      <Td align="right">{fmtNum(c.activeAds)}</Td>
                      <Td color="var(--color-text-3)">
                        {c.platforms.length ? c.platforms.join(", ") : "—"}
                      </Td>
                      <Td
                        align="right"
                        color={
                          c.isOwn
                            ? "var(--color-success)"
                            : "var(--color-coral)"
                        }
                      >
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
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div
              style={{
                marginTop: 36,
                display: "grid",
                gap: 22,
                justifyItems: "center",
              }}
            >
              <ScoreLine value={ads.pillar} />
              <CtaPill href={ctaHref} cta="ads" label="Start tracking" />
            </div>
          </>
        ) : (
          <MissingNote>
            {
              "We haven't mapped the ads running in your area yet. Mapsly tracks every competitor advertising on Google and Meta for your services — so you see who's buying the patients you could win."
            }
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
          fontSize: 13.5,
          color: "var(--color-text-2)",
          lineHeight: 1.3,
          maxWidth: 130,
        }}
      >
        {label}
      </p>
      <p
        style={{
          margin: "12px 0 0",
          fontFamily: SERIF,
          fontSize: 40,
          fontWeight: 700,
          lineHeight: 1,
          color: coral ? "var(--color-coral)" : "var(--color-text)",
        }}
      >
        {fmtNum(value)}
        <span style={{ fontSize: 20, fontWeight: 400 }}> {unit}</span>
      </p>
    </div>
  );
}

/** Stacked "Your problem / Your solution" with a tan connecting arrow (ads). */
function ProblemSolutionStacked({ gap }: { gap: LandingGap }) {
  const box = (label: string, color: string, text: string) => (
    <div
      style={{
        background: "var(--color-bg-3)",
        borderRadius: 16,
        padding: "18px 22px",
        fontSize: 15,
        lineHeight: 1.5,
        color: "var(--color-text-2)",
      }}
    >
      <strong style={{ color }}>{label}</strong> {text}
    </div>
  );
  return (
    <div style={{ position: "relative", display: "grid", gap: 14 }}>
      {box("Your problem:", "var(--color-coral)", gap.problem)}
      {box("Your solution:", "var(--color-success)", gap.solution)}
      <div
        className="landing-ps-arrow"
        aria-hidden
        style={{
          position: "absolute",
          right: -34,
          top: "24%",
          color: "var(--color-gold)",
        }}
      >
        <svg width="54" height="96" viewBox="0 0 54 96" fill="none">
          <path
            d="M4 6c32 2 46 20 42 48-3 16-14 26-22 32"
            stroke="currentColor"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M14 82l10 4m-10-4l4-10"
            stroke="currentColor"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- reviews section */

function ReviewsSection({
  reviews,
  gap,
  ctaHref,
}: {
  reviews: LandingReviewsData;
  gap: LandingGap | null;
  ctaHref: string;
}) {
  return (
    <section data-landing-section="reviews" style={sectionStyle("white")}>
      <div style={CONTAINER}>
        <SectionIntro
          eyebrow="Why patients choose competitors?"
          title="What patients praise"
          emphasis="at the places they pick over you."
          intro={
            "We read every public review for your top competitors and counted what patients keep coming back to mention — what's pulling them in next door, and what they expect you to offer too."
          }
        />

        {reviews.hasData ? (
          <>
            <div
              style={{
                ...CARD,
                marginTop: 36,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 24,
                background: "var(--color-bg-3)",
                border: "none",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                Your Google score:
              </span>
              <span
                style={{ fontFamily: SERIF, fontSize: 40, fontWeight: 600 }}
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
                  ↗ +{reviews.trend30d} this month
                </span>
              ) : null}
            </div>

            <div
              className="landing-2col"
              style={{
                marginTop: 18,
                display: "grid",
                gap: 18,
                gridTemplateColumns: "minmax(0, 1.55fr) minmax(240px, 1fr)",
              }}
            >
              <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
                <p
                  style={{
                    ...miniLabel,
                    padding: "16px 16px 0",
                    textTransform: "none",
                    fontFamily: SERIF,
                    fontSize: 17,
                    color: "var(--color-text)",
                    letterSpacing: 0,
                  }}
                >
                  You compared to your competitors:
                </p>
                <table style={{ ...tableStyle, marginTop: 8 }}>
                  <thead>
                    <tr>
                      <Th>Company</Th>
                      <Th align="right">Score</Th>
                      <Th align="right">Reviews</Th>
                      <Th align="right">30d</Th>
                      <Th align="right">Reply rate</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviews.competitors.map((c, i) => {
                      const own = c.isOwn;
                      const txt = own
                        ? "var(--color-coral)"
                        : "var(--color-text)";
                      const prevRank = reviews.competitors[i - 1]?.rank;
                      const gapRow = prevRank != null && c.rank > prevRank + 1;
                      return (
                        <tr key={`${c.name}-${c.rank}`}>
                          <Td color={txt}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 10,
                              }}
                            >
                              {gapRow ? (
                                <span
                                  style={{ color: "var(--color-text-3)" }}
                                  aria-hidden
                                >
                                  ⋮
                                </span>
                              ) : null}
                              <RankBadge rank={c.rank} isOwn={own} />
                              <span style={{ fontWeight: own ? 700 : 400 }}>
                                {c.name}
                              </span>
                              {own ? (
                                <em
                                  style={{
                                    color: "var(--color-coral)",
                                    fontStyle: "italic",
                                    fontWeight: 700,
                                  }}
                                >
                                  You!
                                </em>
                              ) : null}
                            </span>
                          </Td>
                          <Td align="right" color={txt}>
                            {fmtRating(c.rating)} ★
                          </Td>
                          <Td align="right" color={txt}>
                            {fmtNum(c.reviewCount)}
                          </Td>
                          <Td align="right" color={txt}>
                            {c.trend30d ?? 0}
                          </Td>
                          <Td align="right" color={txt}>
                            {fmtPct(c.responseRate)}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={CARD}>
                <p
                  style={{
                    margin: 0,
                    fontFamily: SERIF,
                    fontSize: 17,
                    fontWeight: 600,
                  }}
                >
                  What services clients mention in your reviews?
                </p>
                {reviews.themes.length > 0 ? (
                  <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
                    {reviews.themes.slice(0, 5).map((t) => (
                      <div
                        key={t.label}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          background: "var(--color-bg-3)",
                          borderRadius: 12,
                          padding: "10px 14px",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13.5,
                            color: "var(--color-text-2)",
                            lineHeight: 1.3,
                          }}
                        >
                          <strong style={{ color: "var(--color-success)" }}>
                            {t.label}
                          </strong>{" "}
                          mentioned by patients
                        </span>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            flexShrink: 0,
                          }}
                        >
                          <span
                            style={{
                              width: 18,
                              height: 1,
                              background: "var(--color-coral)",
                            }}
                            aria-hidden
                          />
                          <span
                            style={{
                              fontFamily: SERIF,
                              fontSize: 26,
                              fontWeight: 600,
                            }}
                          >
                            {t.count}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--color-text-3)",
                            }}
                          >
                            times
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p
                    style={{
                      marginTop: 14,
                      fontSize: 13.5,
                      color: "var(--color-text-3)",
                    }}
                  >
                    {
                      "We'll surface the services patients mention once your reviews are pulled."
                    }
                  </p>
                )}
              </div>
            </div>

            {gap ? <ProblemSolution gap={gap} /> : null}
            <div style={{ marginTop: 24, textAlign: "center" }}>
              <ScoreLine value={reviews.pillar} />
            </div>
          </>
        ) : (
          <MissingNote>
            {
              "We haven't pulled your reviews yet. Mapsly reads every review you and your competitors get — what patients praise, what they complain about, and how fast owners reply."
            }
          </MissingNote>
        )}

        <SectionFooterCta ctaHref={ctaHref} cta="reviews" />
      </div>
    </section>
  );
}

/* --------------------------------------------------------- website section */

function WebsiteSection({
  website,
  gap,
  ctaHref,
}: {
  website: LandingWebsiteData;
  gap: LandingGap | null;
  ctaHref: string;
}) {
  const host = website.websiteUrl ? safeHost(website.websiteUrl) : null;
  return (
    <section data-landing-section="website" style={sectionStyle("cream")}>
      <div style={CONTAINER}>
        <SectionIntro
          eyebrow="Your website · multi-check audit"
          title="Your website,"
          emphasis="graded on 12 things patients notice."
          intro={
            "We check your site against the median of the top 10 websites in your metro — not just the #1. Each item below is a booking-driver patients silently judge you on."
          }
        />

        {website.hasData ? (
          <div
            className="landing-2col"
            style={{
              marginTop: 40,
              display: "grid",
              gap: 18,
              gridTemplateColumns: "minmax(240px, 0.85fr) minmax(0, 1.6fr)",
            }}
          >
            <div style={CARD}>
              <p
                style={{
                  margin: 0,
                  fontFamily: SERIF,
                  fontSize: 18,
                  fontWeight: 600,
                }}
              >
                Score of your website:
              </p>
              <div style={{ marginTop: 16 }}>
                <p style={miniLabel}>Your score</p>
                <p
                  style={{
                    ...bigStat,
                    fontSize: 48,
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
                  <span
                    style={{
                      fontFamily: "var(--font-landing-body)",
                      fontSize: 16,
                      fontWeight: 400,
                      color: "var(--color-text-3)",
                    }}
                  >
                    {" "}
                    /100
                  </span>
                </p>
                {host ? <p style={subStat}>{host}</p> : null}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                  marginTop: 18,
                }}
              >
                <div>
                  <p style={miniLabel}>Industry median</p>
                  <p style={{ ...bigStat, fontSize: 30 }}>
                    {website.industryMedian ?? "—"}
                    <span style={slash}>/100</span>
                  </p>
                  <p style={subStat}>midpoint of top 10</p>
                </div>
                <div>
                  <p style={miniLabel}>Industry best</p>
                  <p
                    style={{
                      ...bigStat,
                      fontSize: 30,
                      color: "var(--color-success)",
                    }}
                  >
                    {website.industryBest ?? "—"}
                    <span style={slash}>/100</span>
                  </p>
                  <p style={subStat}>top of your category</p>
                </div>
              </div>
              <p
                style={{
                  margin: "18px 0 0",
                  fontSize: 12.5,
                  color: "var(--color-text-3)",
                  lineHeight: 1.5,
                }}
              >
                Full per-check breakdown with fix steps + weekly tracking
                available on Mapsly Pro.
              </p>
              <div style={{ marginTop: 16 }}>
                <ScoreLine value={website.pillar} />
              </div>
            </div>

            <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
              <p
                style={{
                  padding: "18px 18px 0",
                  margin: 0,
                  fontFamily: SERIF,
                  fontSize: 19,
                  fontWeight: 600,
                  lineHeight: 1.25,
                }}
              >
                {website.passCount} of {website.totalChecks} checks passing.{" "}
                <span
                  style={{
                    color: "var(--color-text-3)",
                    fontWeight: 400,
                    fontSize: 15,
                  }}
                >
                  Most top-10 sites pass 9+. What&apos;s missing:
                </span>
              </p>
              <table style={{ ...tableStyle, marginTop: 10 }}>
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
                    return (
                      <tr key={c.key}>
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
                              style={{ color: col, fontWeight: 700 }}
                            >
                              {ok ? "✓" : fail ? "✕" : "·"}
                            </span>
                            {c.label}
                          </span>
                        </Td>
                        <Td color={col}>{c.detail}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <MissingNote>
            {
              "We haven't audited your website yet. Mapsly checks it against the 12 things patients (and Google) notice — speed, booking buttons, mobile, and more — every week."
            }
          </MissingNote>
        )}

        {gap ? <ProblemSolution gap={gap} /> : null}
        <SectionFooterCta
          ctaHref={ctaHref}
          cta="website"
          label="Full per-check breakdown"
        />
      </div>
    </section>
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
      <div style={CONTAINER}>
        <SectionIntro
          eyebrow="Your diagnosis · what to fix? what changes?"
          title="Where you stand."
          emphasis="What to fix."
          suffix="What changes."
          intro={
            "Three steps, one flow. First: where you are now. Then: the three highest-impact fixes our algorithm surfaced. Finally: a live projection of what changes when you apply them."
          }
        />
        {top.length > 0 ? (
          <div
            style={{
              marginTop: 40,
              display: "grid",
              gap: 18,
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            }}
          >
            {top.map((f) => (
              <div
                key={f.rank}
                style={{
                  ...CARD,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    fontSize: 40,
                    lineHeight: 1,
                    color: "var(--color-gold-2)",
                    fontWeight: 700,
                  }}
                >
                  ✓
                </span>
                <p
                  style={{
                    margin: 0,
                    fontSize: 16.5,
                    fontWeight: 600,
                    color: "var(--color-text)",
                    lineHeight: 1.4,
                    flex: 1,
                  }}
                >
                  {f.action}
                  {f.meta ? (
                    <span
                      style={{
                        display: "block",
                        marginTop: 6,
                        fontSize: 13,
                        fontWeight: 400,
                        color: "var(--color-text-3)",
                      }}
                    >
                      {f.meta}
                    </span>
                  ) : null}
                </p>
                <p
                  style={{
                    margin: 0,
                    fontFamily: SERIF,
                    fontSize: 26,
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
          <MissingNote>
            {
              "Once we've tracked a full week we'll line up your highest-impact fixes here, in order."
            }
          </MissingNote>
        )}
        <div style={{ marginTop: 40, textAlign: "center" }}>
          <CtaPill href={ctaHref} cta="fixes" label="Start tracking" />
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- pricing section */

function PricingSection({ ctaHref }: { ctaHref: string }) {
  const props = [
    "Catch new competitor ads within 24h",
    "AI-draft a reply to every new review",
    "Weekly digest of every market move",
    "Spot ranking drops before they cost bookings",
  ];
  return (
    <section
      data-landing-section="pricing"
      style={{
        background: "var(--color-coral)",
        padding: "clamp(56px, 8vw, 104px) 20px",
      }}
    >
      <div
        className="landing-2col"
        style={{
          ...CONTAINER,
          display: "grid",
          gap: 56,
          gridTemplateColumns: "minmax(0, 1.3fr) minmax(300px, 1fr)",
          alignItems: "center",
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontFamily: SERIF,
              fontSize: "clamp(38px, 5.6vw, 64px)",
              fontWeight: 600,
              lineHeight: 1.02,
              color: "#fff",
            }}
          >
            More patients. Fewer surprises.{" "}
            <em style={{ fontStyle: "italic" }}>$29/month.</em>
          </h2>
          <p
            style={{
              margin: "22px 0 0",
              maxWidth: 480,
              fontSize: 17,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.82)",
            }}
          >
            {
              "Reply to every Google review in one click. Watch your competitors while you sleep. Catch the moment a new ad targets your patients. Find the keywords quietly costing you bookings."
            }
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "14px 28px",
              marginTop: 30,
              maxWidth: 560,
            }}
          >
            {props.map((p) => (
              <span
                key={p}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  color: "rgba(255,255,255,0.95)",
                  fontSize: 15,
                  lineHeight: 1.4,
                }}
              >
                <span aria-hidden style={{ color: "#fff", fontWeight: 700 }}>
                  ✓
                </span>
                {p}
              </span>
            ))}
          </div>
        </div>

        <div style={{ position: "relative" }}>
          <div
            style={{
              position: "absolute",
              left: -86,
              bottom: 40,
              display: "none",
            }}
            className="landing-pricing-arrow"
          >
            <CurlyArrow />
          </div>
          <div
            style={{
              background: "#fff",
              borderRadius: 24,
              padding: "30px 28px",
              textAlign: "center",
            }}
          >
            <p
              style={{
                margin: 0,
                fontFamily: MONO,
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--color-coral)",
              }}
            >
              Get more customers!
            </p>
            <p
              style={{
                margin: "14px 0 0",
                fontFamily: SERIF,
                fontSize: 40,
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              Mapsly Pro
            </p>
            <p
              style={{
                margin: "16px 0 0",
                fontSize: 13,
                color: "var(--color-text-3)",
              }}
            >
              from
            </p>
            <p
              style={{
                margin: "2px 0 22px",
                fontFamily: SERIF,
                fontSize: 60,
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              $29
              <span
                style={{
                  fontFamily: "var(--font-landing-body)",
                  fontSize: 17,
                  fontWeight: 400,
                  color: "var(--color-text-3)",
                }}
              >
                {" "}
                /mo
              </span>
            </p>
            <div style={{ display: "grid", gap: 12 }}>
              <span style={{ display: "grid" }}>
                <CtaPill
                  href={ctaHref}
                  cta="pricing"
                  label="Start tracking · $29/mo"
                />
              </span>
              <span style={{ display: "grid" }}>
                <CtaPill
                  href={ctaHref}
                  cta="pricing-annual"
                  label="Pay annually · save $120"
                  variant="outline"
                />
              </span>
            </div>
            <p
              style={{
                margin: "20px 0 0",
                fontSize: 12,
                color: "var(--color-text-3)",
                lineHeight: 1.5,
              }}
            >
              30-day money-back guarantee · cancel anytime · no contract · first
              data refresh within 24 hours.
            </p>
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
      style={{ background: "var(--color-coral)", padding: "0 20px 40px" }}
    >
      <div
        style={{
          ...CONTAINER,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          paddingTop: 8,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 16 }}>
          <Wordmark light />
          <span style={{ color: "rgba(255,255,255,0.78)", fontSize: 15 }}>
            Your business. <em style={{ fontStyle: "italic" }}>Mapped.</em>
          </span>
        </span>
        <span
          style={{
            display: "inline-flex",
            gap: 24,
            flexWrap: "wrap",
            color: "rgba(255,255,255,0.78)",
            fontSize: 13,
          }}
        >
          <span>Google stats</span>
          <span>Ads</span>
          <span>Reviews stats</span>
          <span>Website stats</span>
        </span>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------- small shared bits */

function SectionFooterCta({
  ctaHref,
  cta,
  label = "Start tracking",
}: {
  ctaHref: string;
  cta: string;
  label?: string;
}) {
  return (
    <div style={{ marginTop: 32, textAlign: "center" }}>
      <CtaPill href={ctaHref} cta={cta} label={label} />
    </div>
  );
}

function OwnTag() {
  return (
    <span
      style={{
        marginLeft: 8,
        padding: "1px 7px",
        borderRadius: 6,
        background: "var(--color-coral)",
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      You
    </span>
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

const miniLabel: CSSProperties = {
  margin: 0,
  fontFamily: MONO,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--color-text-3)",
};
const bigStat: CSSProperties = {
  margin: "8px 0 0",
  fontFamily: SERIF,
  fontSize: 34,
  fontWeight: 600,
  color: "var(--color-text)",
  lineHeight: 1,
};
const subStat: CSSProperties = {
  margin: "4px 0 0",
  fontSize: 12,
  color: "var(--color-text-3)",
};
const slash: CSSProperties = {
  fontFamily: "var(--font-landing-body)",
  fontSize: 13,
  fontWeight: 400,
  color: "var(--color-text-3)",
};

/* ------------------------------------------------------------------- view */

export function LandingView({ data }: { data: LandingData }) {
  const ctaHref = `/signin?intent=smb&landing=${encodeURIComponent(data.token)}`;
  return (
    <main style={PAGE}>
      <LandingAnalytics token={data.token} />
      <TopBar ctaHref={ctaHref} />
      <Hero data={data} />
      <ChangesSection changes={data.changes} />
      <SearchSection
        search={data.search}
        gap={data.gap}
        category={data.category}
        ctaHref={ctaHref}
      />
      <AdsSection
        ads={data.adsDetail}
        gap={data.gap}
        name={data.name}
        ctaHref={ctaHref}
      />
      <ReviewsSection reviews={data.reviews} gap={data.gap} ctaHref={ctaHref} />
      <WebsiteSection
        website={data.websiteDetail}
        gap={data.gap}
        ctaHref={ctaHref}
      />
      <FixesSection fixes={data.fixes} ctaHref={ctaHref} />
      <PricingSection ctaHref={ctaHref} />
      <Footer />
    </main>
  );
}
