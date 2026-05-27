// Server component · top 5 keywords by raw search volume for /(smb)/search.
//
// Maria's "where the demand is" lens. Each row shows:
//   - Keyword + monthly search volume
//   - Maria's Maps position + Maria's organic position
//   - Top 3 businesses in Maps for this keyword (from packSlots — Maria's
//     row is coral-highlighted)
//   - Missed-customers pill (when Maria is outside the Maps top 3)
//
// Pure presentation · all data comes from `topByVolume` in queries.ts.
// Replaces the dense 25-row "Every keyword we track" table that scored
// 3/10 on Maria-fit in the PO review.

import * as React from "react";

import type { KeywordRow } from "../types";

export interface TopKeywordsCardLabels {
  /** "Where the demand is" */
  heading: string;
  /** "Top 5 searches your customers do · we look across all 200 we track" */
  subtitle: string;
  /** "{value}/mo" with {value} replaced inline · for the search-volume pill */
  volumeTemplate: string;
  /** "Maps" small caption above the Maps rank value */
  mapsLabel: string;
  /** "Search" small caption above the organic rank value */
  organicLabel: string;
  /** "#{rank}" big-number value · {rank} replaced inline */
  rankTemplate: string;
  /** Big-value text shown when Maria isn't ranked at all for a surface */
  notRanked: string;
  /** "Top 3 in Maps" mini-section heading above the pack-slot row */
  topThreeInMapsLabel: string;
  /** "—" or "Not in Maps yet" for the empty pack-slot fallback */
  emptySlot: string;
  /** "≈ {count} customers/mo you miss" pill copy */
  missedTemplate: string;
  /** "You're already in the top 3 here" pill copy */
  inTopThree: string;
  /** Empty section copy when topByVolume is empty (rare). */
  empty: string;
}

export interface TopKeywordsCardProps {
  rows: readonly KeywordRow[];
  labels: TopKeywordsCardLabels;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function TopKeywordsCard({ rows, labels }: TopKeywordsCardProps) {
  if (rows.length === 0) {
    return (
      <section
        aria-labelledby="top-keywords-heading"
        style={{
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          padding: "20px 24px",
          marginBottom: 24,
          boxShadow: "0 2px 8px rgba(28, 25, 22, 0.04)",
        }}
      >
        <h2
          id="top-keywords-heading"
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
            margin: "10px 0 0",
            color: "var(--color-text-2)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {labels.empty}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="top-keywords-heading"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "20px 24px",
        marginBottom: 24,
        boxShadow: "0 2px 8px rgba(28, 25, 22, 0.04)",
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <h2
          id="top-keywords-heading"
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

      <ol
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {rows.map((row) => (
          <TopKeywordRow key={row.id} row={row} labels={labels} />
        ))}
      </ol>
    </section>
  );
}

function TopKeywordRow({
  row,
  labels,
}: {
  row: KeywordRow;
  labels: TopKeywordsCardLabels;
}) {
  const mapsValue =
    row.localPackRank != null
      ? labels.rankTemplate.replace("{rank}", String(row.localPackRank))
      : labels.notRanked;
  const organicValue =
    row.organicRank != null
      ? labels.rankTemplate.replace("{rank}", String(row.organicRank))
      : labels.notRanked;

  const inTopThreeMaps = row.localPackRank != null && row.localPackRank <= 3;
  const showMissedPill = !inTopThreeMaps && row.estPatientsLost > 0;
  const showTopThreeBadge = inTopThreeMaps;

  return (
    <li
      style={{
        background: "var(--color-bg-1, #faf6f1)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3
            style={{
              margin: 0,
              fontFamily: "var(--font-serif)",
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              lineHeight: 1.3,
              color: "var(--color-text)",
              wordBreak: "break-word",
            }}
          >
            {row.keyword}
          </h3>
          {row.searchVolume != null && row.searchVolume > 0 ? (
            <p
              style={{
                margin: "4px 0 0",
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                color: "var(--color-text-3)",
              }}
            >
              {labels.volumeTemplate.replace("{value}", fmt(row.searchVolume))}
            </p>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 16, flexShrink: 0 }}>
          <RankPill
            caption={labels.mapsLabel}
            value={mapsValue}
            tone={
              row.localPackRank == null
                ? "muted"
                : row.localPackRank <= 3
                  ? "good"
                  : "warn"
            }
          />
          <RankPill
            caption={labels.organicLabel}
            value={organicValue}
            tone={
              row.organicRank == null
                ? "muted"
                : row.organicRank <= 10
                  ? "good"
                  : "warn"
            }
          />
        </div>
      </div>

      <div>
        <p
          style={{
            margin: "0 0 6px",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--color-text-3)",
          }}
        >
          {labels.topThreeInMapsLabel}
        </p>
        <ol
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {row.packSlots.map((slot) => (
            <li
              key={slot.rank}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13.5,
                lineHeight: 1.3,
                color:
                  slot.kind === "you"
                    ? "var(--color-coral)"
                    : slot.kind === "empty"
                      ? "var(--color-text-3)"
                      : "var(--color-text)",
                fontWeight: slot.kind === "you" ? 600 : 400,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color:
                    slot.kind === "you"
                      ? "var(--color-coral)"
                      : "var(--color-text-3)",
                  width: 16,
                  flexShrink: 0,
                }}
              >
                {slot.rank}.
              </span>
              <span style={{ minWidth: 0 }}>
                {slot.kind === "empty" ? labels.emptySlot : slot.name}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {showMissedPill ? (
        <div
          style={{
            background: "rgba(195, 85, 58, 0.08)",
            border: "1px solid rgba(195, 85, 58, 0.25)",
            borderRadius: 999,
            padding: "4px 12px",
            alignSelf: "flex-start",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-coral)",
            fontWeight: 600,
          }}
        >
          {labels.missedTemplate.replace("{count}", fmt(row.estPatientsLost))}
        </div>
      ) : null}

      {showTopThreeBadge ? (
        <div
          style={{
            background: "rgba(45, 134, 89, 0.10)",
            border: "1px solid rgba(45, 134, 89, 0.25)",
            borderRadius: 999,
            padding: "4px 12px",
            alignSelf: "flex-start",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-success, #2d8659)",
            fontWeight: 600,
          }}
        >
          {labels.inTopThree}
        </div>
      ) : null}
    </li>
  );
}

function RankPill({
  caption,
  value,
  tone,
}: {
  caption: string;
  value: string;
  tone: "good" | "warn" | "muted";
}) {
  const color =
    tone === "good"
      ? "var(--color-success, #2d8659)"
      : tone === "warn"
        ? "var(--color-coral)"
        : "var(--color-text-3)";
  return (
    <div style={{ textAlign: "right" }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--color-text-3)",
          marginBottom: 2,
        }}
      >
        {caption}
      </div>
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 20,
          fontWeight: 700,
          lineHeight: 1,
          color,
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
    </div>
  );
}
