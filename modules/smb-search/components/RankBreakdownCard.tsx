// Server component · rank-bucket breakdown for /(smb)/search.
//
// Top 3 / Top 4-10 / 11+ buckets · each row shows keyword count +
// summed search volume + estimated visits Maria gets at her current
// rank. Visualised as horizontal bars proportional to total volume
// so the "where am I" answer is one glance away.
//
// "Top 3" uses the BEST of (Maps rank, organic rank) per keyword ·
// matches the bestRank() heuristic in types.ts.

import * as React from "react";

import type { RankBucket } from "../types";

export interface RankBreakdownCardLabels {
  /** Section heading · "Where you show up" */
  heading: string;
  /** Sub-line · "Across all the searches we're tracking for you" */
  subtitle: string;
  /** Bucket labels (left side of each row). */
  top3: string;
  top10: string;
  below10: string;
  /** Footer line · "Top 3 captures most clicks. Below 10 captures almost none." */
  ctrFootnote: string;
  /** Template · "{count} keywords · {searches} searches/mo · ~{visits} visits/mo".
   *  Inline-replaced. */
  rowTemplate: string;
  /** Template · "{count} keywords · {searches} searches/mo" for the
   *  below_10 row where visits ≈ 0. */
  rowTemplateNoVisits: string;
  /** "No keywords here yet" copy for empty buckets. */
  empty: string;
}

export interface RankBreakdownCardProps {
  buckets: readonly RankBucket[];
  labels: RankBreakdownCardLabels;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function RankBreakdownCard({ buckets, labels }: RankBreakdownCardProps) {
  const totalVolume = buckets.reduce((s, b) => s + b.totalSearchVolume, 0);
  const top3 = buckets.find((b) => b.key === "top_3");
  const top10 = buckets.find((b) => b.key === "top_10");
  const below10 = buckets.find((b) => b.key === "below_10");

  // Don't render if there are zero tracked keywords entirely.
  if (totalVolume === 0 && buckets.every((b) => b.keywordCount === 0)) {
    return null;
  }

  return (
    <section
      aria-labelledby="rank-breakdown-heading"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "20px 24px 18px",
        marginBottom: 24,
        boxShadow: "0 2px 8px rgba(28, 25, 22, 0.04)",
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <h2
          id="rank-breakdown-heading"
          style={{
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontSize: 18,
            letterSpacing: "-0.01em",
            color: "var(--color-text)",
          }}
        >
          {labels.heading}
        </h2>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 12.5,
            color: "var(--color-text-2)",
          }}
        >
          {labels.subtitle}
        </p>
      </header>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <BucketRow
          label={labels.top3}
          bucket={top3}
          totalVolume={totalVolume}
          rowTemplate={labels.rowTemplate}
          tone="good"
          empty={labels.empty}
        />
        <BucketRow
          label={labels.top10}
          bucket={top10}
          totalVolume={totalVolume}
          rowTemplate={labels.rowTemplate}
          tone="warn"
          empty={labels.empty}
        />
        <BucketRow
          label={labels.below10}
          bucket={below10}
          totalVolume={totalVolume}
          rowTemplate={labels.rowTemplateNoVisits}
          tone="bad"
          empty={labels.empty}
        />
      </ul>

      <p
        style={{
          margin: "14px 0 0",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--color-text-3)",
          lineHeight: 1.5,
        }}
      >
        {labels.ctrFootnote}
      </p>
    </section>
  );
}

function BucketRow({
  label,
  bucket,
  totalVolume,
  rowTemplate,
  tone,
  empty,
}: {
  label: string;
  bucket: RankBucket | undefined;
  totalVolume: number;
  rowTemplate: string;
  tone: "good" | "warn" | "bad";
  empty: string;
}) {
  const count = bucket?.keywordCount ?? 0;
  const searches = bucket?.totalSearchVolume ?? 0;
  const visits = bucket?.estimatedVisits ?? 0;
  const pct = totalVolume > 0 ? (searches / totalVolume) * 100 : 0;

  const barColor =
    tone === "good"
      ? "var(--color-success, #2d8659)"
      : tone === "warn"
        ? "var(--color-gold, #d4a574)"
        : "var(--color-coral)";

  const summary =
    count === 0
      ? empty
      : rowTemplate
          .replace("{count}", fmt(count))
          .replace("{searches}", fmt(searches))
          .replace("{visits}", fmt(visits));

  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(120px, 1fr) 2fr",
        gap: 16,
        alignItems: "center",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-text)",
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--color-text-2)",
            marginTop: 2,
            lineHeight: 1.4,
          }}
        >
          {summary}
        </div>
      </div>
      <div
        role="presentation"
        style={{
          height: 18,
          background: "var(--color-bg-3, #ece3d6)",
          borderRadius: 9,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            width: `${Math.max(pct, 1)}%`,
            height: "100%",
            background: barColor,
            transition: "width 200ms ease",
            borderRadius: 9,
          }}
        />
      </div>
    </li>
  );
}
