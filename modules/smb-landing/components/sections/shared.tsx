/**
 * Shared landing primitives — formatting helpers, section intro, CTA pill,
 * problem→solution callouts, stars, table cells. Extracted verbatim from
 * LandingView.tsx during the per-section split; render output is identical.
 */

import type { CSSProperties, ReactNode } from "react";

import type { LandingGap } from "../../types";

import { BODY, CONTAINER, EYEBROW, SERIF } from "./style-tokens";

/* ----------------------------------------------------------------- helpers */

export function fmtScore(v: number | null): string {
  return v == null ? "—" : v.toFixed(1);
}

export function fmtRating(v: number | null): string {
  return v == null ? "—" : v.toFixed(1);
}

export function fmtNum(v: number | null): string {
  return v == null ? "—" : new Intl.NumberFormat("en-US").format(v);
}

export function fmtPct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/** Fading hairline between the four analysis blocks (transparent → #D9D9D9 → transparent). */

export function SectionDivider() {
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

/* -------------------------------------------------------------- primitives */

/** Centered eyebrow + serif heading (with coral-italic emphasis) + subhead. */

export function SectionIntro({
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
    <div style={{ textAlign: "center", maxWidth: 900, margin: "0 auto" }}>
      <p style={EYEBROW}>{eyebrow}</p>
      <h2
        className="landing-section-h2"
        style={{
          fontFamily: SERIF,
          fontWeight: 600,
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
            fontFamily: BODY,
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

export function ScoreLine({ value }: { value: number | null }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: BODY,
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

export function CtaPill({
  href,
  cta,
  label,
  mobileLabel,
  variant = "solid",
  height = 70,
}: {
  href: string;
  cta: string;
  label: string;
  mobileLabel?: string;
  variant?: "solid" | "outline" | "light";
  height?: number;
}) {
  // padding + font-size live on .landing-cta-pill in landing.css (the
  // sticky-header pill compacts them at ≤560px); height stays inline (prop).
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height,
    borderRadius: 999,
    fontFamily: BODY,
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
            boxShadow: "none",
          }
        : {
            ...base,
            background: "transparent",
            color: "var(--color-coral)",
            border: "1px solid var(--color-coral)",
            boxShadow: "none",
          };
  return (
    <a
      href={href}
      data-landing-cta={cta}
      className={`landing-cta-pill${variant === "outline" ? " landing-cta-pill--outline" : ""}`}
      style={style}
    >
      {mobileLabel ? (
        <>
          <span className="landing-cta-label-lg">{label}</span>
          <span className="landing-cta-label-sm">{mobileLabel}</span>
        </>
      ) : (
        label
      )}
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

/** Bold the numeric values and their unit (~1,360 searches a month · $29). */

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

export function ProblemSolution({ gap }: { gap: LandingGap }) {
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
      className="landing-ps-block"
      style={{
        position: "relative",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "stretch",
        marginTop: 38,
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
        className="landing-ps-arrow-main"
        aria-hidden
        style={{
          position: "absolute",
          zIndex: 2,
          display: "grid",
          placeItems: "center",
          pointerEvents: "none",
        }}
      >
        <svg
          className="landing-ps-svg-desktop"
          width="72"
          height="64"
          viewBox="0 0 96 86"
          fill="none"
        >
          <path
            d="M5.05365 46.8099C32.0409 24.8242 62.1701 33.6625 73.8613 40.8298"
            stroke="#ECE6DE"
            strokeWidth="16"
          />
          <path
            d="M51.8809 61.3122L83.0203 42.264L66.0974 8.29907"
            stroke="#ECE6DE"
            strokeWidth="13"
          />
        </svg>
        <svg
          className="landing-ps-svg-mobile"
          width="56"
          height="90"
          viewBox="0 0 82 132"
          fill="none"
        >
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

export function ProblemSolutionStacked({ gap }: { gap: LandingGap }) {
  const baseBox: CSSProperties = {
    borderRadius: 22,
    padding: "18px 22px",
    fontSize: 15,
    lineHeight: 1.5,
    color: "var(--color-text)",
  };
  return (
    <div
      className="landing-ps-block"
      style={{ position: "relative", display: "grid", gap: 14 }}
    >
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

export function MissingNote({ children }: { children: ReactNode }) {
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
        fontFamily: BODY,
        fontSize: 14.5,
        lineHeight: 1.55,
        textAlign: "center",
      }}
    >
      {children}
    </p>
  );
}

export const STAR_D =
  "M8.07655 1.50176C8.10776 1.4387 8.15598 1.38561 8.21576 1.3485C8.27554 1.31138 8.34451 1.29172 8.41487 1.29172C8.48524 1.29172 8.5542 1.31138 8.61398 1.3485C8.67376 1.38561 8.72198 1.4387 8.7532 1.50176L10.3985 4.83441C10.5069 5.05376 10.6669 5.24354 10.8648 5.38745C11.0626 5.53135 11.2925 5.6251 11.5346 5.66063L15.2141 6.1991C15.2838 6.2092 15.3493 6.23861 15.4032 6.284C15.4571 6.32939 15.4972 6.38895 15.5189 6.45594C15.5407 6.52293 15.5433 6.59469 15.5265 6.66309C15.5096 6.73148 15.4739 6.7938 15.4235 6.84298L12.7625 9.43417C12.587 9.60518 12.4557 9.81628 12.3799 10.0493C12.3041 10.2823 12.286 10.5303 12.3273 10.7718L12.9555 14.4328C12.9678 14.5025 12.9603 14.5742 12.9338 14.6398C12.9073 14.7054 12.8629 14.7623 12.8056 14.8039C12.7484 14.8455 12.6806 14.8701 12.61 14.875C12.5394 14.8799 12.4688 14.8649 12.4064 14.8317L9.11716 13.1023C8.90043 12.9885 8.65931 12.929 8.41452 12.929C8.16973 12.929 7.9286 12.9885 7.71187 13.1023L4.42338 14.8317C4.36094 14.8647 4.29047 14.8796 4.22 14.8746C4.14952 14.8696 4.08187 14.8449 4.02473 14.8033C3.96759 14.7618 3.92326 14.705 3.89678 14.6395C3.8703 14.574 3.86273 14.5024 3.87494 14.4328L4.50244 10.7725C4.54389 10.5309 4.52594 10.2828 4.45012 10.0496C4.3743 9.81644 4.2429 9.60522 4.06725 9.43417L1.40626 6.84369C1.3554 6.79457 1.31936 6.73215 1.30224 6.66354C1.28513 6.59494 1.28762 6.5229 1.30945 6.45565C1.33127 6.38839 1.37155 6.32861 1.42569 6.28313C1.47983 6.23765 1.54565 6.20828 1.61566 6.19838L5.29447 5.66063C5.53682 5.62537 5.76698 5.53175 5.96512 5.38783C6.16327 5.2439 6.32347 5.05398 6.43195 4.83441L8.07655 1.50176Z";

export function Stars({ value }: { value: number | null }) {
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

export function CurlyArrow({ color = "#fff" }: { color?: string }) {
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

export function RankBadge({ rank, isOwn }: { rank: number; isOwn?: boolean }) {
  const bg = isOwn
    ? "#7DA88B"
    : rank === 1
      ? "var(--color-success)"
      : "#DE9B54";
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
        fontWeight: 600,
        flexShrink: 0,
        boxShadow: `0 0 20px 0 ${bg}`,
      }}
    >
      {rank}
    </span>
  );
}

/* table primitives */

export function Th({
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
        fontFamily: BODY,
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "var(--color-text-3)",
        borderBottom: "1px solid #F1F4F6",
        boxShadow: "inset 0 -1px 0 #F1F4F6",
        fontWeight: 400,
      }}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align,
  color,
  weight,
  borderOpacity,
}: {
  children: ReactNode;
  align?: "right" | "center";
  color?: string;
  weight?: number;
  borderOpacity?: number;
}) {
  return (
    <td
      style={{
        textAlign: align ?? "left",
        padding: "12px 14px",
        fontSize: 14,
        fontWeight: weight,
        color: color ?? "var(--color-text)",
        // `opacity` on a <tr> doesn't reach collapsed borders, so fade the line
        // here directly to match a dimmed row (#F1F4F6 = rgb(241,244,246)).
        borderBottom: `1px solid rgba(241, 244, 246, ${borderOpacity ?? 1})`,
      }}
    >
      {children}
    </td>
  );
}

/* ------------------------------------------------------- small shared bits */

export function SectionFooterCta({
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
