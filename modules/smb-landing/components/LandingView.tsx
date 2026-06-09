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

import type { SmbMarketChange, SmbOverviewFix } from "@/modules/smb-home/types";
import type {
  LandingAdsData,
  LandingCopy,
  LandingData,
  LandingGap,
  LandingReviewsData,
  LandingSearchData,
  LandingWebsiteData,
} from "../types";

import { LandingAnalytics } from "./LandingAnalytics";
import { LandingChangesFeed } from "./LandingChangesFeed";
import { StickyHeader } from "./StickyHeader";

/* ----------------------------------------------------------------- helpers */

function fmtScore(v: number | null): string {
  return v == null ? "—" : v.toFixed(1);
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
  background: "#fff",
  overflowX: "clip",
  fontFamily: "var(--font-landing-body)",
  color: "var(--color-text)",
};

const CONTAINER: CSSProperties = { maxWidth: 1280, margin: "0 auto" };

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
/** Fading hairline between the four analysis blocks (transparent → #D9D9D9 → transparent). */

function SectionDivider() {
  return (
    <div style={{ background: "var(--color-bg-2)", padding: "0 20px" }}>
      <div style={CONTAINER}>
        <div
          aria-hidden
          style={{
            height: 1,
            background:
              "linear-gradient(to right, transparent, #D9D9D9 50%, transparent)",
          }}
        />
      </div>
    </div>
  );
}

const SERIF = "var(--font-landing-head)";
// Eyebrow/label text uses Montserrat too (no separate monospace face) — the
// landing runs on two families only: FreightBig Pro (serif) + Montserrat (sans).

const MONO = "var(--font-landing-body)";

// Shared eyebrow/label style — Montserrat SemiBold 16/32, coral, no transform.

const EYEBROW: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-landing-body)",
  fontWeight: 600,
  fontSize: 16,
  lineHeight: "32px",
  letterSpacing: "0",
  color: "var(--color-coral)",
};

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
      <p style={EYEBROW}>{eyebrow}</p>
      <h2
        style={{
          margin: "16px 0 0",
          fontFamily: SERIF,
          fontSize: "clamp(40px, 7vw, 80px)",
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
            fontSize: 18,
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

function ScoreLine({ value }: { value: number | null }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-landing-body)",
        fontSize: 16,
        fontWeight: 600,
        color: "var(--color-text)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#FFFD54",
          display: "inline-block",
        }}
      />
      Mapsly score:{" "}
      <strong
        style={{ fontFamily: SERIF, fontSize: 32, color: "var(--color-text)" }}
      >
        {fmtScore(value)}
      </strong>
      <span
        style={{ color: "var(--color-text)", fontSize: 13, fontWeight: 600 }}
      >
        {" "}
        / 10
      </span>
    </div>
  );
}

function CtaPill({
  href,
  cta,
  label,
  variant = "solid",
  height = 70,
}: {
  href: string;
  cta: string;
  label: string;
  variant?: "solid" | "outline" | "light";
  height?: number;
}) {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height,
    padding: "0 38px",
    borderRadius: 999,
    fontFamily: "var(--font-landing-body)",
    fontSize: 15,
    fontWeight: 600,
    textDecoration: "none",
    whiteSpace: "nowrap",
    boxShadow:
      "0 12px 30px color-mix(in srgb, var(--color-coral) 30%, transparent)",
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
      {label}
      <svg
        width="25"
        height="12"
        viewBox="0 0 25 12"
        fill="none"
        aria-hidden
        style={{ flexShrink: 0 }}
      >
        <path
          d="M0 5.71411L23 5.71411"
          stroke="currentColor"
          strokeWidth="1.49732"
        />
        <path
          d="M23.5 5.39362L17.9944 10.8992"
          stroke="currentColor"
          strokeWidth="1.49732"
        />
        <path
          d="M23.5 6.03497L17.9944 0.529397"
          stroke="currentColor"
          strokeWidth="1.49732"
        />
      </svg>
    </a>
  );
}

/** Bold the numeric values and their unit (~1,360 searches a month · $29 · 89%). */

function boldValues(text: string): ReactNode[] {
  return text
    .split(/([~$]?\d[\d,.]*%?(?:\s+searches(?:\s+a\s+month|\s*\/\s*mo)?)?)/g)
    .map((part, i) =>
      /\d/.test(part) ? (
        <strong key={i} style={{ fontWeight: 600 }}>
          {part}
        </strong>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
}

/** "Your problem → Your solution" two-box callout. */

function ProblemSolution({ gap }: { gap: LandingGap }) {
  const box: CSSProperties = {
    flex: "1 1 320px",
    borderRadius: 22,
    padding: "16px 20px",
    fontSize: 14.5,
    lineHeight: 1.5,
    color: "var(--color-text)",
  };
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "stretch",
        gap: 28,
        marginTop: 18,
      }}
    >
      <div style={{ ...box, background: "#F9F6F6" }}>
        <strong style={{ color: "var(--color-coral)" }}>Your problem:</strong>{" "}
        {boldValues(gap.problem)}
      </div>
      <div style={{ ...box, background: "#F3F5F4", fontWeight: 600 }}>
        <strong style={{ color: "var(--color-success)" }}>
          Your solution:
        </strong>{" "}
        {gap.solution}
      </div>
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 2,
          display: "grid",
          placeItems: "center",
          pointerEvents: "none",
        }}
      >
        <svg
          width="46"
          height="51"
          viewBox="0 0 58 64"
          fill="none"
          style={{ display: "block" }}
        >
          <path
            d="M23.8146 4.47144L48.9258 30.9653L23.7489 59.3576"
            stroke="#ECE6DE"
            strokeWidth="13"
          />
          <path
            d="M42.4863 31.2214L0.486328 31.2214"
            stroke="#ECE6DE"
            strokeWidth="16"
          />
        </svg>
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

const STAR_D =
  "M8.07655 1.50176C8.10776 1.4387 8.15598 1.38561 8.21576 1.3485C8.27554 1.31138 8.34451 1.29172 8.41487 1.29172C8.48524 1.29172 8.5542 1.31138 8.61398 1.3485C8.67376 1.38561 8.72198 1.4387 8.7532 1.50176L10.3985 4.83441C10.5069 5.05376 10.6669 5.24354 10.8648 5.38745C11.0626 5.53135 11.2925 5.6251 11.5346 5.66063L15.2141 6.1991C15.2838 6.2092 15.3493 6.23861 15.4032 6.284C15.4571 6.32939 15.4972 6.38895 15.5189 6.45594C15.5407 6.52293 15.5433 6.59469 15.5265 6.66309C15.5096 6.73148 15.4739 6.7938 15.4235 6.84298L12.7625 9.43417C12.587 9.60518 12.4557 9.81628 12.3799 10.0493C12.3041 10.2823 12.286 10.5303 12.3273 10.7718L12.9555 14.4328C12.9678 14.5025 12.9603 14.5742 12.9338 14.6398C12.9073 14.7054 12.8629 14.7623 12.8056 14.8039C12.7484 14.8455 12.6806 14.8701 12.61 14.875C12.5394 14.8799 12.4688 14.8649 12.4064 14.8317L9.11716 13.1023C8.90043 12.9885 8.65931 12.929 8.41452 12.929C8.16973 12.929 7.9286 12.9885 7.71187 13.1023L4.42338 14.8317C4.36094 14.8647 4.29047 14.8796 4.22 14.8746C4.14952 14.8696 4.08187 14.8449 4.02473 14.8033C3.96759 14.7618 3.92326 14.705 3.89678 14.6395C3.8703 14.574 3.86273 14.5024 3.87494 14.4328L4.50244 10.7725C4.54389 10.5309 4.52594 10.2828 4.45012 10.0496C4.3743 9.81644 4.2429 9.60522 4.06725 9.43417L1.40626 6.84369C1.3554 6.79457 1.31936 6.73215 1.30224 6.66354C1.28513 6.59494 1.28762 6.5229 1.30945 6.45565C1.33127 6.38839 1.37155 6.32861 1.42569 6.28313C1.47983 6.23765 1.54565 6.20828 1.61566 6.19838L5.29447 5.66063C5.53682 5.62537 5.76698 5.53175 5.96512 5.38783C6.16327 5.2439 6.32347 5.05398 6.43195 4.83441L8.07655 1.50176Z";

function Stars({ value }: { value: number | null }) {
  const n = value == null ? 0 : Math.round(value);
  return (
    <span
      aria-hidden
      style={{ display: "inline-flex", gap: 3, alignItems: "center" }}
    >
      {Array.from({ length: 5 }, (_, i) => {
        const c = i < Math.min(5, n) ? "#FCC800" : "#F3EFEA";
        return (
          <svg key={i} width="18" height="17" viewBox="0 0 18 17" fill="none">
            <path
              d={STAR_D}
              fill={c}
              stroke={c}
              strokeWidth="1.42452"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
      })}
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
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${arc} ${C}`}
          transform="rotate(135 60 60)"
        />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="#fffd54"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${arc * frac} ${C}`}
          transform="rotate(135 60 60)"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          top: 10,
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
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-text)",
            marginTop: 8,
          }}
        >
          / 10
        </span>
      </div>
    </div>
  );
}

function CurlyArrow({ color = "#fff" }: { color?: string }) {
  return (
    <svg
      width="200"
      height="83"
      viewBox="0 0 225 93"
      fill="none"
      aria-hidden
      style={{ color }}
    >
      <path
        d="M6.24171 20.7403C12.1806 41.2142 43.8013 92.0972 91.3205 84.8722C134.228 78.3484 149.235 32.0073 130.834 10.8583C119.206 -2.5076 102.503 17.2393 113.419 38.1472C124.335 59.0551 149.529 73.8979 174.174 58.7947C195.422 45.7733 197.99 33.001 208.497 22.484"
        stroke="currentColor"
        strokeWidth="13"
        strokeLinecap="butt"
        strokeLinejoin="miter"
        fill="none"
      />
      <path
        d="M174.755 20.8623L211.031 16.7949L218.51 53.9979"
        stroke="currentColor"
        strokeWidth="13"
        strokeLinecap="butt"
        strokeLinejoin="miter"
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
        position: "sticky",
        top: 0,
        zIndex: 1,
        background: "var(--color-bg-2)",
        textAlign: align ?? "left",
        padding: "10px 14px",
        fontFamily: MONO,
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "var(--color-text-3)",
        borderBottom: "1px solid #F1F4F6",
        boxShadow: "inset 0 -1px 0 #F1F4F6",
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
        borderBottom: "1px solid #F1F4F6",
      }}
    >
      {children}
    </td>
  );
}

function TopBar({ ctaHref }: { ctaHref: string }) {
  return (
    <StickyHeader>
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
        <CtaPill
          href={ctaHref}
          cta="top"
          label="Start tracking - $29/mo"
          height={60}
        />
      </div>
    </StickyHeader>
  );
}

function Wordmark({ light }: { light?: boolean }) {
  // Single brand lockup (icon + "mapsly"). Inlined for crisp rendering at any
  // DPI and zero extra request. `light` recolors it for dark backgrounds:
  // the wordmark + map ticks follow `currentColor`, the pin goes solid white
  // with the inner mark cut out in the surrounding coral. Default keeps the
  // brand red pin with the wordmark in the site text color.
  const ink = light ? "#fff" : "var(--color-text)";
  const pinFill = light ? "#fff" : "#f81b1e";
  const pinInner = light ? "var(--color-coral)" : "#fff";
  return (
    <svg
      viewBox="0 0 127 36"
      role="img"
      aria-label="Mapsly"
      fill="none"
      style={{ height: 30, width: "auto", display: "block", color: ink }}
    >
      <path
        d="M118.516 34.6228C117.705 34.6228 116.894 34.5292 116.083 34.3421C115.292 34.1757 114.565 33.895 113.899 33.4999C113.255 33.1256 112.693 32.6473 112.215 32.0651L113.618 29.8505C114.159 30.5991 114.856 31.1397 115.708 31.4725C116.561 31.826 117.465 32.0027 118.422 32.0027C119.711 32.0027 120.741 31.722 121.51 31.1605C122.279 30.6199 122.841 29.8297 123.194 28.79C123.548 27.7502 123.725 26.5338 123.725 25.1405L124.036 21.5847H123.662C123.475 23.1859 123.122 24.4647 122.602 25.4213C122.082 26.3778 121.437 27.0744 120.668 27.5111C119.919 27.9478 119.067 28.1661 118.11 28.1661C116.904 28.1661 115.906 27.8646 115.116 27.2616C114.325 26.6377 113.733 25.7436 113.338 24.5791C112.963 23.4146 112.776 22.0214 112.776 20.3994V13.506H115.615V19.838C115.615 21.7926 115.885 23.2379 116.426 24.1736C116.987 25.1094 117.84 25.5772 118.983 25.5772C119.628 25.5772 120.21 25.4317 120.73 25.1405C121.271 24.8286 121.728 24.3608 122.103 23.7369C122.477 23.1131 122.768 22.3437 122.976 21.4287C123.205 20.493 123.329 19.4013 123.35 18.1536V13.506H126.189V25.2341C126.189 26.1699 126.116 27.0952 125.97 28.0102C125.825 28.9251 125.575 29.7777 125.222 30.5679C124.889 31.3581 124.432 32.0547 123.849 32.6577C123.267 33.2816 122.539 33.7598 121.666 34.0926C120.793 34.4461 119.742 34.6228 118.516 34.6228Z"
        fill="currentColor"
      />
      <path
        d="M106.312 29.6321V8.14105H109.151V29.6321H106.312Z"
        fill="currentColor"
      />
      <path
        d="M96.885 30.0376C95.8245 30.0376 94.8576 29.9232 93.9842 29.6945C93.1108 29.4658 92.3726 29.1227 91.7696 28.6652C91.1665 28.2077 90.6987 27.6255 90.366 26.9184C90.054 26.1906 89.9189 25.3485 89.9605 24.3919L92.487 23.9552C92.4246 24.8286 92.5702 25.546 92.9237 26.1075C93.298 26.6689 93.8386 27.0848 94.5456 27.3551C95.2527 27.6047 96.074 27.7294 97.0098 27.7294C98.2367 27.7294 99.1828 27.5319 99.8482 27.1368C100.534 26.7209 100.878 26.1387 100.878 25.3901C100.878 24.8286 100.69 24.3919 100.316 24.08C99.9626 23.7473 99.4531 23.4874 98.7877 23.3002C98.1223 23.0923 97.3633 22.9051 96.5107 22.7388C95.6997 22.5724 94.9095 22.3853 94.1402 22.1773C93.3916 21.9694 92.7157 21.699 92.1127 21.3663C91.5097 21.0336 91.0314 20.5969 90.6779 20.0563C90.3244 19.4948 90.1476 18.7878 90.1476 17.9352C90.1476 16.9579 90.4075 16.1157 90.9274 15.4087C91.4473 14.6809 92.1855 14.1195 93.142 13.7244C94.0986 13.3085 95.2215 13.1005 96.5107 13.1005C97.7584 13.1005 98.8605 13.2981 99.817 13.6932C100.794 14.0883 101.564 14.6913 102.125 15.5023C102.687 16.2925 102.967 17.2906 102.967 18.4967L100.441 18.9646C100.462 18.1536 100.295 17.4882 99.9418 16.9683C99.6091 16.4484 99.1308 16.0637 98.507 15.8142C97.9039 15.5439 97.1969 15.4087 96.386 15.4087C95.3046 15.4087 94.4417 15.6271 93.797 16.0637C93.1732 16.4796 92.8613 17.0515 92.8613 17.7793C92.8613 18.3615 93.0484 18.819 93.4227 19.1517C93.8178 19.4844 94.3481 19.7444 95.0135 19.9315C95.6789 20.0979 96.4275 20.2642 97.2593 20.4306C98.0495 20.5761 98.8189 20.7529 99.5675 20.9608C100.316 21.148 100.992 21.4079 101.595 21.7406C102.198 22.0733 102.687 22.5308 103.061 23.1131C103.435 23.6745 103.622 24.4023 103.622 25.2965C103.622 26.2946 103.342 27.1472 102.78 27.8542C102.24 28.5612 101.46 29.1019 100.441 29.4762C99.4427 29.8505 98.2575 30.0376 96.885 30.0376Z"
        fill="currentColor"
      />
      <path
        d="M72.5137 34.2797L72.5449 21.0856L72.5137 13.506H75.1338L74.853 18.3095H75.1962C75.4665 17.1243 75.8512 16.1469 76.3503 15.3775C76.8493 14.6081 77.4628 14.0363 78.1906 13.662C78.9184 13.2877 79.7605 13.1005 80.7171 13.1005C82.0479 13.1005 83.1916 13.4332 84.1482 14.0987C85.1255 14.7641 85.8741 15.731 86.394 16.9995C86.9138 18.2472 87.1738 19.7548 87.1738 21.5223C87.1738 23.3106 86.9138 24.839 86.394 26.1075C85.8741 27.3759 85.1359 28.3533 84.1794 29.0395C83.2436 29.7049 82.1415 30.0376 80.873 30.0376C79.7709 30.0376 78.8352 29.7985 78.0658 29.3202C77.2964 28.8211 76.6726 28.1349 76.1943 27.2616C75.7368 26.3882 75.4041 25.4004 75.1962 24.2983H74.7907C74.9154 25.0677 75.0194 25.7955 75.1026 26.4818C75.1858 27.168 75.2481 27.823 75.2897 28.4468C75.3521 29.0499 75.3833 29.6321 75.3833 30.1936V34.2797H72.5137ZM80.0933 27.5423C80.9666 27.5423 81.7152 27.2927 82.3391 26.7937C82.9629 26.2946 83.4412 25.598 83.7739 24.7038C84.1066 23.8097 84.2729 22.7492 84.2729 21.5223C84.2729 20.337 84.1066 19.3077 83.7739 18.4343C83.462 17.5609 82.9941 16.8851 82.3702 16.4068C81.7672 15.9078 81.0082 15.6582 80.0933 15.6582C79.3239 15.6582 78.648 15.835 78.0658 16.1885C77.4835 16.5212 76.9949 16.9683 76.5998 17.5297C76.2047 18.0704 75.9032 18.663 75.6952 19.3077C75.5081 19.9523 75.4145 20.5865 75.4145 21.2104V21.5535C75.4145 21.9694 75.4665 22.4372 75.5705 22.9571C75.6744 23.477 75.8408 24.0072 76.0695 24.5479C76.2983 25.0677 76.5894 25.5564 76.9429 26.0139C77.3172 26.4714 77.7643 26.8457 78.2841 27.1368C78.8248 27.4071 79.4278 27.5423 80.0933 27.5423Z"
        fill="currentColor"
      />
      <path
        d="M60.0166 30.0376C59.1641 30.0376 58.3739 29.8817 57.6461 29.5697C56.9391 29.237 56.3776 28.7484 55.9617 28.1037C55.5458 27.4383 55.3379 26.5857 55.3379 25.546C55.3379 24.6934 55.4938 23.9656 55.8058 23.3626C56.1385 22.7596 56.6064 22.2709 57.2094 21.8966C57.8332 21.5015 58.5818 21.1896 59.4552 20.9608C60.3286 20.7113 61.3163 20.5034 62.4184 20.337C63.4165 20.1706 64.1755 20.0355 64.6954 19.9315C65.2361 19.8275 65.6 19.6716 65.7871 19.4636C65.9951 19.2557 66.099 18.9438 66.099 18.5279C66.099 17.6129 65.7871 16.8851 65.1633 16.3445C64.5602 15.783 63.7181 15.5023 62.6367 15.5023C62.0337 15.5023 61.4307 15.6167 60.8276 15.8454C60.2246 16.0741 59.7047 16.4484 59.268 16.9683C58.8314 17.4674 58.561 18.164 58.4571 19.0581L55.837 18.4655C55.9617 17.5297 56.2217 16.7292 56.6167 16.0637C57.0326 15.3775 57.5525 14.8161 58.1763 14.3794C58.8002 13.9427 59.4968 13.6204 60.2662 13.4124C61.0356 13.2045 61.8466 13.1005 62.6991 13.1005C63.9884 13.1005 65.0905 13.3293 66.0055 13.7867C66.9412 14.2442 67.6586 14.9512 68.1577 15.9078C68.6567 16.8435 68.9063 18.0392 68.9063 19.4948V22.7699C68.9063 23.4978 68.9167 24.2568 68.9375 25.0469C68.9583 25.8163 68.9791 26.5961 68.9999 27.3863C69.0414 28.1557 69.0726 28.9043 69.0934 29.6321H66.4733C66.4733 28.8211 66.4733 28.0206 66.4733 27.2304C66.4941 26.4194 66.5149 25.5876 66.5357 24.735H66.2238C65.9951 25.7124 65.6104 26.6065 65.0697 27.4175C64.529 28.2077 63.8324 28.8419 62.9799 29.3202C62.1481 29.7985 61.1603 30.0376 60.0166 30.0376ZM60.8276 27.7294C61.3891 27.7294 61.9401 27.6255 62.4808 27.4175C63.0422 27.1888 63.5621 26.8561 64.0404 26.4194C64.5394 25.9827 64.9657 25.442 65.3192 24.7974C65.6935 24.1528 65.9639 23.4042 66.1302 22.5516V20.8049L66.9724 20.7113C66.6813 21.044 66.2654 21.3039 65.7247 21.4911C65.2049 21.6574 64.6122 21.7926 63.9468 21.8966C63.2814 21.9798 62.6056 22.0837 61.9193 22.2085C61.2539 22.3125 60.6405 22.4788 60.079 22.7076C59.5176 22.9363 59.0601 23.2482 58.7066 23.6433C58.3531 24.0384 58.1763 24.5791 58.1763 25.2653C58.1763 26.0347 58.4155 26.6377 58.8937 27.0744C59.372 27.5111 60.0166 27.7294 60.8276 27.7294Z"
        fill="currentColor"
      />
      <path
        d="M29.1523 29.6321V21.2104L29.1211 13.506H31.71L31.3357 20.0251H31.7412C31.9283 18.4447 32.2403 17.145 32.6769 16.1261C33.1344 15.1072 33.7167 14.3482 34.4237 13.8491C35.1515 13.3501 36.0041 13.1005 36.9814 13.1005C38.0627 13.1005 38.9257 13.3813 39.5703 13.9427C40.2357 14.4834 40.714 15.2735 41.0051 16.3133C41.2963 17.3322 41.4106 18.5591 41.3482 19.9939H41.7225C41.9097 18.4551 42.2216 17.1762 42.6583 16.1573C43.1158 15.1384 43.7188 14.3794 44.4674 13.8803C45.216 13.3605 46.0998 13.1005 47.1187 13.1005C47.9713 13.1005 48.7095 13.2669 49.3333 13.5996C49.9571 13.9115 50.477 14.3898 50.8929 15.0344C51.3296 15.6582 51.6519 16.4484 51.8598 17.405C52.0678 18.3615 52.1718 19.474 52.1718 20.7425V29.6321H49.3021V21.148C49.3021 19.9003 49.1981 18.8814 48.9902 18.0912C48.7823 17.2802 48.4599 16.6876 48.0233 16.3133C47.6074 15.9182 47.0563 15.7206 46.3701 15.7206C45.5175 15.7206 44.7689 16.0325 44.1243 16.6564C43.5005 17.2802 43.0118 18.164 42.6583 19.3077C42.3048 20.4514 42.1072 21.803 42.0656 23.3626V29.6321H39.2584V21.1792C39.2584 19.9523 39.144 18.9334 38.9153 18.1224C38.7073 17.3114 38.385 16.7084 37.9483 16.3133C37.5325 15.9182 36.9918 15.7206 36.3264 15.7206C35.453 15.7206 34.7044 16.0325 34.0806 16.6564C33.4567 17.2802 32.9681 18.1744 32.6146 19.3389C32.2611 20.4826 32.0531 21.8446 31.9907 23.425V29.6321H29.1523Z"
        fill="currentColor"
      />
      <path
        d="M22.549 9.71491C22.549 18.1952 12.8341 23.9136 12.8341 23.9136C12.8341 23.9136 3.11914 17.9352 3.11914 9.71491C3.11914 4.34951 7.46865 0 12.8341 0C18.1995 0 22.549 4.34951 22.549 9.71491Z"
        fill={pinFill}
      />
      <path
        d="M16.8139 10.9882C16.7025 11.1774 16.4499 11.1909 15.7756 11.0435C15.0818 10.8919 13.9792 10.6752 13.9658 10.6878C13.951 10.7018 13.616 14.2033 13.5131 15.5973C13.492 15.8837 13.2505 16.1157 12.9634 16.1157C12.6802 16.1157 12.4379 15.8803 12.4173 15.5979C12.3175 14.23 11.9724 10.7682 11.9588 10.7533C11.9424 10.7355 11.3646 10.8556 10.6746 11.0202C9.48944 11.303 9.41284 11.316 9.2888 11.2553C9.13744 11.1812 9.06445 11.0719 9.06445 10.9194C9.06445 10.6572 9.48304 10.2164 10.2308 9.15221C10.8722 8.2392 11.6382 7.14574 11.9329 6.7223C12.591 5.7766 12.6462 5.71674 12.8578 5.71853C12.9464 5.71928 13.0535 5.74479 13.0958 5.77523C13.1695 5.82824 13.3954 6.10641 13.7293 6.5553C13.8763 6.75294 14.1497 7.11079 15.0007 8.21932C15.1993 8.47809 15.5377 8.92078 15.7527 9.20307C15.9676 9.48536 16.2998 9.92153 16.4909 10.1723C16.8651 10.6635 16.9214 10.8057 16.8139 10.9882Z"
        fill={pinInner}
      />
      <path
        d="M2.20549 20.9282L15.0714 33.7942L14.7038 34.1618L1.83789 21.2958L2.20549 20.9282Z"
        fill="currentColor"
      />
      <path
        d="M19.4828 20.5606L23.894 24.9718L23.5264 25.3394L19.1152 20.9282L19.4828 20.5606Z"
        fill="currentColor"
      />
      <path
        d="M10.6597 33.7941L23.5257 20.9282L23.8933 21.2958L11.0273 34.1617L10.6597 33.7941Z"
        fill="currentColor"
      />
      <path
        d="M1.83748 24.9718L6.24865 20.5606L6.61625 20.9282L2.20508 25.3394L1.83748 24.9718Z"
        fill="currentColor"
      />
    </svg>
  );
}

function Tagline({ light }: { light?: boolean }) {
  return (
    <span
      className="landing-tagline"
      style={{
        fontFamily: SERIF,
        fontSize: 22,
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
  borderRadius: 21,
  padding: "26px 22px",
};

const heroCardTitle: CSSProperties = {
  margin: 0,
  fontFamily: SERIF,
  fontSize: 36,
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
        background: "#fff",
        padding: "clamp(20px, 3vw, 40px) 20px clamp(36px, 5vw, 64px)",
      }}
    >
      <div
        className="landing-hero-grid"
        style={{
          ...CONTAINER,
          display: "grid",
          gap: 40,
          gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)",
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
              fontSize: 14,
              color: "var(--color-text)",
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
            <span
              aria-hidden
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
            style={{
              margin: "26px 0 0",
              fontFamily: SERIF,
              fontSize: "clamp(48px, 10vw, 100px)",
              fontWeight: 700,
              lineHeight: 1.02,
              letterSpacing: "-0.02em",
              color: "var(--color-text)",
              textDecorationLine: "underline",
              textDecorationColor: "var(--color-coral)",
              textDecorationThickness: "14px",
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
              maxWidth: 680,
            }}
          >
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: 90,
                height: 2,
                background: "var(--color-coral)",
                marginTop: 30,
              }}
            />
            <p
              style={{
                margin: 0,
                fontSize: 22,
                lineHeight: 1.45,
                color: "var(--color-text)",
              }}
            >
              {data.copy.hero.headline}
              <span
                style={{
                  display: "block",
                  marginTop: 4,
                  fontSize: 22,
                  color: "var(--color-text)",
                }}
              >
                {data.copy.hero.body}
              </span>
            </p>
          </div>
        </div>

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
                position: "static",
                width: "calc(48% - 14px)",
                textAlign: "center",
              }}
            >
              <p style={heroCardTitle}>{data.cellLabel ?? "Your market"}</p>
              <p
                style={{
                  margin: "4px 0 0",
                  fontFamily: SERIF,
                  fontWeight: 700,
                  fontSize: 64,
                  lineHeight: 1,
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                {data.rank ?? "—"}
                {data.total != null ? (
                  <span
                    style={{
                      fontFamily: "var(--font-landing-body)",
                      fontSize: 13,
                      fontWeight: 600,
                      lineHeight: 1,
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
            <p style={heroCardTitle}>Google</p>
            <p
              style={{
                margin: "0",
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
            <p style={{ ...heroCardSub, marginTop: 18 }}>
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
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden
                  style={{
                    display: "inline-block",
                    verticalAlign: "-2px",
                    marginRight: 4,
                  }}
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
                +{trend} this month
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

/* --------------------------------------------------------- changes section */

function ChangesSection({
  events,
  copy,
}: {
  events: SmbMarketChange[];
  copy: LandingCopy["changes"];
}) {
  return (
    <section
      data-landing-section="changes"
      style={{ background: "#ECE6DE", padding: "clamp(56px, 8vw, 104px) 20px" }}
    >
      <div
        className="landing-2col"
        style={{
          ...CONTAINER,
          display: "grid",
          gap: 160,
          gridTemplateColumns: "minmax(0, 1fr) 366px",
          alignItems: "center",
        }}
      >
        <div style={{ marginTop: 30, maxWidth: 700 }}>
          <p style={EYEBROW}>{copy.eyebrow}</p>
          <h2
            style={{
              margin: "20px 0 0",
              fontFamily: SERIF,
              fontSize: "clamp(40px, 7vw, 80px)",
              fontWeight: 700,
              lineHeight: 1.02,
              letterSpacing: "-0.02em",
              color: "var(--color-text)",
            }}
          >
            {copy.title}{" "}
            <em
              style={{
                fontStyle: "italic",
                fontWeight: 600,
                color: "var(--color-coral)",
              }}
            >
              {copy.emphasis}
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
            {copy.subtitle}
          </p>
          <div
            className="landing-changes-arrow"
            style={{
              marginTop: 28,
              display: "flex",
              justifyContent: "center",
              transform: "translateX(250px) translateY(-50px)",
            }}
          >
            <CurlyArrow />
          </div>
        </div>

        <div
          style={{
            transform: "translateX(-120px)",
            maskImage: "linear-gradient(to bottom, #000 55%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to bottom, #000 55%, transparent)",
          }}
        >
          <LandingChangesFeed events={events} />
        </div>
      </div>
    </section>
  );
}

function SearchSection({
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
            className="landing-2col"
            style={{
              marginTop: 44,
              display: "grid",
              gap: 32,
              gridTemplateColumns: "minmax(340px, 0.95fr) minmax(0, 1.35fr)",
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
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 44,
                    marginTop: 26,
                  }}
                >
                  <div>
                    <p style={statCardLabel}>monthly Google searches:</p>
                    <p style={statCardBig}>
                      {total != null ? fmtNum(total) : "—"}
                      <span style={statCardUnit}> / mo</span>
                    </p>
                  </div>
                  <div>
                    <p style={statCardLabel}>Searches you show up only:</p>
                    <p style={{ ...statCardBig, color: "var(--color-coral)" }}>
                      {youGet != null ? fmtNum(youGet) : "—"}
                      <span style={statCardUnit}> / mo</span>
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
                      fontSize: 15.5,
                      lineHeight: 1.5,
                      fontWeight: 600,
                      color: "var(--color-coral)",
                    }}
                  >
                    {copy.lossLine}
                  </p>
                ) : null}
              </div>
              <p
                style={{
                  margin: "40px auto 0",
                  maxWidth: 440,
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: "var(--color-text-3)",
                  textAlign: "center",
                }}
              >
                {copy.futureLine}
              </p>
              <div
                style={{
                  marginTop: 18,
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <ScoreLine value={search.pillar} />
              </div>
              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <CtaPill
                  href={ctaHref}
                  cta="search"
                  label="Start tracking · $29/mo"
                />
              </div>
            </div>

            {/* RIGHT · keyword table */}
            <div>
              <p
                style={{
                  margin: "4px 0 0",
                  fontFamily: SERIF,
                  fontSize: 30,
                  fontWeight: 700,
                }}
              >
                How do people search for you on Google?
              </p>
              <div style={{ position: "relative", marginTop: 14 }}>
                <div
                  className="landing-table-scroll"
                  style={{ maxHeight: 380, overflow: "auto" }}
                >
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
                                  fontSize: 16,
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
                                  fontSize: 16,
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
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-text)",
  lineHeight: 1.3,
  maxWidth: 128,
};

const statCardBig: CSSProperties = {
  margin: "8px 0 0",
  fontFamily: SERIF,
  fontSize: 65,
  fontWeight: 700,
  lineHeight: 1,
  color: "var(--color-text)",
};

const statCardUnit: CSSProperties = {
  fontFamily: "var(--font-landing-body)",
  fontSize: 15,
  fontWeight: 600,
  color: "var(--color-text)",
};

/* ------------------------------------------------------------- ads section */

function AdsSection({
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
                    fontSize: 30,
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
              {copy.gap ? <ProblemSolutionStacked gap={copy.gap} /> : <div />}
            </div>

            <div
              style={{
                marginTop: 52,
                maxWidth: 840,
                marginInline: "auto",
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontFamily: SERIF,
                  fontSize: 30,
                  fontWeight: 700,
                }}
              >
                Ads running near you:
              </p>
              <table
                className="landing-table landing-table--nocaps"
                style={{
                  ...tableStyle,
                  marginTop: 16,
                  width: "100%",
                }}
              >
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
        style={{
          margin: "12px 0 0",
          fontFamily: SERIF,
          fontSize: 50,
          fontWeight: 700,
          lineHeight: 1,
          color: coral ? "var(--color-coral)" : "var(--color-text)",
        }}
      >
        {fmtNum(value)}
        <span style={{ fontSize: 50, fontWeight: 400 }}> {unit}</span>
      </p>
    </div>
  );
}

function ProblemSolutionStacked({ gap }: { gap: LandingGap }) {
  const baseBox: CSSProperties = {
    borderRadius: 22,
    padding: "18px 22px",
    fontSize: 15,
    lineHeight: 1.5,
    color: "var(--color-text)",
  };
  return (
    <div style={{ position: "relative", display: "grid", gap: 14 }}>
      <div style={{ ...baseBox, background: "#F9F6F6" }}>
        <strong style={{ color: "var(--color-coral)" }}>Your problem:</strong>{" "}
        {boldValues(gap.problem)}
      </div>
      <div style={{ ...baseBox, background: "#F3F5F4", fontWeight: 600 }}>
        <strong style={{ color: "var(--color-success)" }}>
          Your solution:
        </strong>{" "}
        {gap.solution}
      </div>
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
        <svg width="56" height="90" viewBox="0 0 82 132" fill="none">
          <path
            d="M0.792969 8.54392C35.9121 5.04395 72.6121 18.2439 73.4121 53.0439C74.2121 87.8439 48.7454 106.211 35.9121 111.044"
            stroke="#ECE6DE"
            strokeWidth="16"
          />
          <path
            d="M33.2284 81.1192L29.161 117.395L66.3639 124.875"
            stroke="#ECE6DE"
            strokeWidth="13"
          />
        </svg>
      </div>
    </div>
  );
}

function ReviewsSection({
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
              style={{
                marginTop: 40,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 24,
                justifyContent: "space-between",
                background: "#F5F5F5",
                borderRadius: 18,
                padding: "22px 34px",
                maxWidth: 965,
                marginInline: "auto",
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700 }}>
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
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden
                    style={{
                      display: "inline-block",
                      verticalAlign: "-2px",
                      marginRight: 4,
                    }}
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
              className="landing-2col"
              style={{
                marginTop: 40,
                display: "grid",
                gap: 48,
                gridTemplateColumns: "minmax(0, 1.85fr) minmax(240px, 1fr)",
                alignItems: "start",
              }}
            >
              <div>
                <p
                  style={{
                    margin: "0 0 8px",
                    fontFamily: SERIF,
                    fontSize: 30,
                    fontWeight: 700,
                  }}
                >
                  You compared to your competitors:
                </p>
                <table className="landing-table" style={tableStyle}>
                  <colgroup>
                    <col style={{ width: "40%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <Th>
                        <span style={{ display: "inline-block", maxWidth: 70 }}>
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
                          <Td color={txt}>
                            {fmtRating(c.rating)}{" "}
                            <svg
                              width="13"
                              height="12"
                              viewBox="0 0 18 17"
                              fill="none"
                              aria-hidden
                              style={{
                                display: "inline-block",
                                verticalAlign: "-1px",
                              }}
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
                          <Td color={txt}>{fmtNum(c.reviewCount)}</Td>
                          <Td color={txt}>{c.trend30d ?? 0}</Td>
                          <Td color={txt}>{fmtPct(c.responseRate)}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  borderLeft: "1px solid #E5E5E5",
                  paddingLeft: 24,
                  marginLeft: -24,
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontFamily: SERIF,
                    fontSize: 30,
                    fontWeight: 700,
                    lineHeight: "30px",
                  }}
                >
                  What services clients mention in your reviews?
                </p>
                {reviews.themes.length > 0 ? (
                  <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
                    {reviews.themes.slice(0, 5).map((t) => (
                      <div
                        key={t.label}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          background: "#F5F5F5",
                          borderRadius: 14,
                          padding: "22px 28px",
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
                              width: 26,
                              height: 2,
                              background: "var(--color-coral)",
                            }}
                            aria-hidden
                          />
                          <span
                            style={{
                              fontFamily: SERIF,
                              fontSize: 40,
                              fontWeight: 600,
                            }}
                          >
                            {t.count}
                          </span>
                          <span
                            style={{
                              fontSize: 13,
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
                    {`We'll surface the services ${noun} mention once your reviews are pulled.`}
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

        <SectionFooterCta ctaHref={ctaHref} cta="reviews" />
      </div>
    </section>
  );
}

function WebsiteSection({
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
            className="landing-2col"
            style={{
              marginTop: 44,
              display: "grid",
              gap: 40,
              gridTemplateColumns: "minmax(280px, 0.92fr) minmax(0, 1.5fr)",
              alignItems: "start",
            }}
          >
            <div
              style={{
                background: "var(--color-bg-3)",
                borderRadius: 21,
                padding: 28,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 18,
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontFamily: SERIF,
                    fontSize: 22,
                    fontWeight: 700,
                    lineHeight: 1.2,
                  }}
                >
                  Score of your website:
                </p>
                <WebStat
                  label="Your score:"
                  value={perf != null ? Math.round(perf) : null}
                  sub={host ?? undefined}
                  color={yourColor}
                  big
                />
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 18,
                  marginTop: 24,
                }}
              >
                <WebStat
                  label="Industry median (top 10):"
                  value={website.industryMedian}
                  sub={`midpoint of the top 10 sites${city ? ` in ${city}` : ""}`}
                />
                <WebStat
                  label="Industry best (p90):"
                  value={website.industryBest}
                  sub="top 10% of websites in your category"
                  color="var(--color-success)"
                />
              </div>
              <p
                style={{
                  margin: "22px 0 0",
                  fontSize: 12.5,
                  color: "var(--color-text-3)",
                  lineHeight: 1.5,
                }}
              >
                Full per-check breakdown with fix steps + weekly tracking
                available on Mapsly Pro.
              </p>
              <div
                style={{
                  marginTop: 36,
                  display: "grid",
                  gap: 6,
                  justifyItems: "center",
                }}
              >
                <ScoreLine value={website.pillar} />
                <CtaPill
                  href={ctaHref}
                  cta="website"
                  label="Full per-check breakdown"
                />
              </div>
            </div>

            <div>
              <p
                style={{
                  margin: 0,
                  fontFamily: SERIF,
                  fontSize: 22,
                  fontWeight: 700,
                  lineHeight: 1.25,
                }}
              >
                {website.passCount} of {website.totalChecks} checks passing.{" "}
                <span
                  style={{
                    color: "var(--color-text-3)",
                    fontWeight: 400,
                    fontSize: 16,
                  }}
                >
                  Most top-10 sites pass 9+. What&apos;s missing:
                </span>
              </p>
              <div style={{ position: "relative", marginTop: 16 }}>
                <div style={{ maxHeight: 440, overflow: "hidden" }}>
                  <table className="landing-table" style={tableStyle}>
                    <thead>
                      <tr>
                        <Th>Check</Th>
                        <Th>Your stats:</Th>
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
            {`We haven't audited your website yet. Mapsly checks it against the 12 things ${noun} (and Google) notice — speed, booking buttons, mobile, and more — every week.`}
          </MissingNote>
        )}

        {copy.gap ? <ProblemSolution gap={copy.gap} /> : null}
      </div>
    </section>
  );
}

function WebStat({
  label,
  value,
  sub,
  color,
  big,
}: {
  label: string;
  value: number | null;
  sub?: string;
  color?: string;
  big?: boolean;
}) {
  return (
    <div>
      <p
        style={{
          margin: 0,
          fontSize: 13.5,
          color: "var(--color-text-2)",
          lineHeight: 1.3,
        }}
      >
        {label}
      </p>
      <p
        style={{
          margin: "8px 0 0",
          fontFamily: SERIF,
          fontSize: big ? 48 : 34,
          fontWeight: 700,
          lineHeight: 1,
          color: color ?? "var(--color-text)",
        }}
      >
        {value ?? "—"}
        <span
          style={{
            fontFamily: "var(--font-landing-body)",
            fontSize: big ? 16 : 13,
            fontWeight: 400,
            color: "var(--color-text-3)",
          }}
        >
          {" "}
          /100
        </span>
      </p>
      {sub ? (
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 12,
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

/* ----------------------------------------------------------- fixes section */

function FixesSection({
  fixes,
  copy,
  ctaHref,
}: {
  fixes: SmbOverviewFix[];
  copy: LandingCopy["fixes"];
  ctaHref: string;
}) {
  const top = fixes.slice(0, 3);
  return (
    <section
      data-landing-section="fixes"
      style={{
        background: "#f3f3f1",
        padding: "clamp(56px, 8vw, 104px) 20px",
      }}
    >
      <div style={CONTAINER}>
        <SectionIntro
          eyebrow={copy.eyebrow}
          title={copy.title}
          emphasis={copy.emphasis}
          intro={copy.intro}
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
                  padding: 28,
                  borderRadius: 20,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                <svg
                  width={42}
                  height={42}
                  viewBox="0 0 42 42"
                  fill="none"
                  aria-hidden
                  style={{ display: "block" }}
                >
                  <path
                    d="M9 22.5 L18 31 L34 12"
                    stroke="var(--color-gold-2)"
                    strokeWidth={5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
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
                    fontSize: 30,
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
          <CtaPill href={ctaHref} cta="fixes" label="Start tracking · $29/mo" />
        </div>
      </div>
    </section>
  );
}

function PricingSection({
  copy,
  ctaHref,
  ctaHrefAnnual,
}: {
  copy: LandingCopy["pricing"];
  ctaHref: string;
  ctaHrefAnnual: string;
}) {
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
              fontSize: "clamp(40px, 7vw, 80px)",
              fontWeight: 600,
              lineHeight: 1.02,
              color: "#fff",
            }}
          >
            {copy.titleLead}{" "}
            <em style={{ fontStyle: "italic" }}>{copy.emphasis}</em>
          </h2>
          <p
            style={{
              margin: "22px 0 0",
              maxWidth: 480,
              fontSize: 18,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.72)",
            }}
          >
            {copy.body}
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
              borderRadius: 28,
              padding: "38px 32px",
              textAlign: "center",
            }}
          >
            <p
              style={{
                margin: 0,
                fontFamily: "var(--font-landing-body)",
                fontSize: 15,
                fontWeight: 600,
                color: "var(--color-coral)",
              }}
            >
              Get more customers!
            </p>
            <p
              style={{
                margin: "14px 0 0",
                fontFamily: SERIF,
                fontSize: 44,
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
                fontSize: 64,
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              $29
              <span
                style={{
                  fontFamily: "var(--font-landing-body)",
                  fontSize: 18,
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
                  label="Start tracking - $29/mo"
                />
              </span>
              <span style={{ display: "grid" }}>
                <CtaPill
                  href={ctaHrefAnnual}
                  cta="pricing-annual"
                  label="Pay annually - Save $120"
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
              {copy.guarantee}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

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
    <div style={{ marginTop: 6, textAlign: "center" }}>
      <CtaPill href={ctaHref} cta={cta} label={label} />
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

/* ------------------------------------------------------------------- view */

export function LandingView({ data }: { data: LandingData }) {
  // Direct-from-landing checkout — no sign-in first. An anonymous Stripe
  // subscription session; the prospect is auto-logged-in + their business
  // claimed after payment (see /api/checkout/start → /checkout/return).
  const checkoutBase = `/api/checkout/start?landing=${encodeURIComponent(data.token)}`;
  const ctaHref = `${checkoutBase}&term=monthly`;
  const ctaHrefAnnual = `${checkoutBase}&term=annual`;
  return (
    <main style={PAGE}>
      <LandingAnalytics token={data.token} />
      <TopBar ctaHref={ctaHref} />
      <Hero data={data} />
      <ChangesSection events={data.events} copy={data.copy.changes} />
      <SearchSection
        search={data.search}
        category={data.category}
        copy={data.copy.search}
        noun={data.copy.noun.many}
        ctaHref={ctaHref}
      />
      <SectionDivider />
      <AdsSection
        ads={data.adsDetail}
        name={data.name}
        copy={data.copy.ads}
        noun={data.copy.noun.many}
        ctaHref={ctaHref}
      />
      <SectionDivider />
      <ReviewsSection
        reviews={data.reviews}
        copy={data.copy.reviews}
        noun={data.copy.noun.many}
        ctaHref={ctaHref}
      />
      <SectionDivider />
      <WebsiteSection
        website={data.websiteDetail}
        city={data.city}
        copy={data.copy.website}
        noun={data.copy.noun.many}
        ctaHref={ctaHref}
      />
      <FixesSection
        fixes={data.fixes}
        copy={data.copy.fixes}
        ctaHref={ctaHref}
      />
      <PricingSection
        copy={data.copy.pricing}
        ctaHref={ctaHref}
        ctaHrefAnnual={ctaHrefAnnual}
      />
      <Footer />
    </main>
  );
}
