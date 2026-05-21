import * as React from "react";

import type { ProspectRecord } from "../types";

/**
 * ProspectStats · 6 KPI tiles below the hero.
 *
 * Per `_design/agency/prospect.html`:
 *
 *   - Mapsly Score · MSI rank · Rating · Reviews · Reply rate · Lighthouse
 *   - Big numbers, mono labels, dense layout · Tom-friendly density
 *   - Color-coded · alert (red), warn (amber), success (teal), indigo
 */

export interface ProspectStatsLabels {
  mapslyScore: string;
  msiRank: string;
  rating: string;
  reviewCount: string;
  replyRate: string;
  lighthousePerf: string;
}

export interface ProspectStatsProps {
  prospect: ProspectRecord;
  labels: ProspectStatsLabels;
}

type Tone = "alert" | "warn" | "success" | "indigo" | "neutral";

function toneColor(tone: Tone): string {
  switch (tone) {
    case "alert":
      return "var(--color-alert, #dc2626)";
    case "warn":
      return "var(--color-warn, #b45309)";
    case "success":
      return "var(--color-success, #166534)";
    case "indigo":
      return "var(--color-agency-indigo)";
    default:
      return "var(--color-text)";
  }
}

interface StatTile {
  label: string;
  value: string;
  meta: string;
  tone: Tone;
}

export function ProspectStats({ prospect, labels }: ProspectStatsProps) {
  const tiles: StatTile[] = [];

  // Mapsly Score
  if (prospect.snapshot?.mapslyScore != null) {
    const score = prospect.snapshot.mapslyScore;
    const scoreTone: Tone =
      score >= 7 ? "success" : score >= 5 ? "warn" : "alert";
    tiles.push({
      label: labels.mapslyScore,
      value: score.toFixed(1),
      meta: "0-10 composite",
      tone: scoreTone,
    });
  } else {
    tiles.push({
      label: labels.mapslyScore,
      value: "—",
      meta: "no snapshot yet",
      tone: "neutral",
    });
  }

  // MSI rank
  if (
    prospect.snapshot?.msiRank != null &&
    prospect.snapshot?.msiTotal != null
  ) {
    const rank = prospect.snapshot.msiRank;
    const total = prospect.snapshot.msiTotal;
    const tone: Tone =
      total > 0 && rank / total <= 0.2
        ? "success"
        : total > 0 && rank / total >= 0.6
          ? "warn"
          : "neutral";
    tiles.push({
      label: labels.msiRank,
      value: `#${rank}`,
      meta: `of ${total} in metro`,
      tone,
    });
  } else {
    tiles.push({
      label: labels.msiRank,
      value: "—",
      meta: "metro rank pending",
      tone: "neutral",
    });
  }

  // Rating
  if (prospect.rating != null) {
    const tone: Tone =
      prospect.rating >= 4.5
        ? "success"
        : prospect.rating >= 4.0
          ? "warn"
          : "alert";
    tiles.push({
      label: labels.rating,
      value: prospect.rating.toFixed(1),
      meta: "★ out of 5",
      tone,
    });
  } else {
    tiles.push({
      label: labels.rating,
      value: "—",
      meta: "unrated",
      tone: "neutral",
    });
  }

  // Reviews
  tiles.push({
    label: labels.reviewCount,
    value: String(prospect.reviewCount),
    meta: prospect.reviewCount === 0 ? "no reviews yet" : "reviews on file",
    tone: prospect.reviewCount === 0 ? "warn" : "neutral",
  });

  // Reply rate (communicationScore)
  if (prospect.snapshot?.communicationScore != null) {
    const pct = Math.round(prospect.snapshot.communicationScore * 100);
    const tone: Tone = pct < 30 ? "alert" : pct < 60 ? "warn" : "success";
    tiles.push({
      label: labels.replyRate,
      value: `${pct}%`,
      meta: "benchmark 89%",
      tone,
    });
  } else {
    tiles.push({
      label: labels.replyRate,
      value: "—",
      meta: "no comms signal",
      tone: "neutral",
    });
  }

  // Lighthouse perf
  if (prospect.lighthouse?.performance != null) {
    const v = Math.round(prospect.lighthouse.performance);
    const tone: Tone = v < 50 ? "alert" : v < 70 ? "warn" : "success";
    tiles.push({
      label: labels.lighthousePerf,
      value: String(v),
      meta: "mobile Lighthouse",
      tone,
    });
  } else {
    tiles.push({
      label: labels.lighthousePerf,
      value: "—",
      meta: "no audit yet",
      tone: "neutral",
    });
  }

  return (
    <div
      role="list"
      aria-label="Prospect KPIs"
      data-testid="prospect-stats"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(6, minmax(0,1fr))",
        gap: 16,
        marginBottom: 22,
      }}
      className="prospect-stats-grid"
    >
      {tiles.map((t) => (
        <div
          key={t.label}
          role="listitem"
          style={{
            background: "var(--color-bg-2)",
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            padding: "14px 16px",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--color-text-3)",
              marginBottom: 6,
            }}
          >
            {t.label}
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              color: toneColor(t.tone),
            }}
          >
            {t.value}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--color-text-3)",
              marginTop: 5,
              fontFamily: "var(--font-mono)",
            }}
          >
            {t.meta}
          </div>
        </div>
      ))}
    </div>
  );
}
