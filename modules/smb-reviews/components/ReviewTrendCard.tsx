// modules/smb-reviews/components/ReviewTrendCard.tsx
//
// R.6 · 12-month review trend graph for /(smb)/reviews.
// Server component · pure SVG (no chart lib dep, no client JS).
// Bars: count per month. Overlay: avg-star line.

import type { ReviewTrendsData } from "@/modules/reviews/trends";

export interface ReviewTrendCardLabels {
  eyebrow: string;
  title: string;
  /** "Last 30 days: {n} reviews ({delta:+}+/- vs prior 30d)" */
  rollingLine: string;
  empty: string;
  yAxisCount: string;
  yAxisStars: string;
  /** "Last updated {relative}" */
  lastUpdated: string;
}

interface Props {
  data: ReviewTrendsData;
  labels: ReviewTrendCardLabels;
}

const WIDTH = 600;
const HEIGHT = 120;
const PADDING = { top: 12, right: 28, bottom: 24, left: 24 };
const INNER_W = WIDTH - PADDING.left - PADDING.right;
const INNER_H = HEIGHT - PADDING.top - PADDING.bottom;

export function ReviewTrendCard({ data, labels }: Props) {
  const maxCount = Math.max(1, ...data.monthly.map((b) => b.count));
  const hasData = data.monthly.some((b) => b.count > 0);

  if (!hasData) {
    return (
      <Card labels={labels}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-2)" }}>
          {labels.empty}
        </p>
      </Card>
    );
  }

  const barWidth = INNER_W / data.monthly.length - 4;
  const delta = data.rolling30d - data.rolling30dPrior;
  const deltaSign = delta > 0 ? "+" : delta < 0 ? "" : "";
  const rollingText = labels.rollingLine
    .replace("{n}", String(data.rolling30d))
    .replace("{delta}", `${deltaSign}${delta}`);

  return (
    <Card labels={labels}>
      <p
        style={{
          margin: "0 0 6px",
          fontSize: 12,
          color: "var(--color-text-2)",
        }}
      >
        {rollingText}
      </p>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="12-month review trend"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {/* Bars · count per month */}
        {data.monthly.map((b, i) => {
          const x = PADDING.left + i * (INNER_W / data.monthly.length) + 2;
          const h = (b.count / maxCount) * INNER_H;
          const y = PADDING.top + (INNER_H - h);
          return (
            <g key={b.month}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={h}
                rx={3}
                fill="var(--color-coral)"
                opacity={b.count === 0 ? 0.15 : 0.75}
              />
              <text
                x={x + barWidth / 2}
                y={HEIGHT - 8}
                textAnchor="middle"
                fontSize={9}
                fontFamily="var(--font-mono)"
                fill="var(--color-text-3)"
              >
                {b.month.slice(5)}
              </text>
            </g>
          );
        })}

        {/* Avg-star polyline overlay */}
        <polyline
          points={data.monthly
            .map((b, i) => {
              const x =
                PADDING.left +
                i * (INNER_W / data.monthly.length) +
                barWidth / 2 +
                2;
              const avg = b.avgStars ?? 0;
              const y = PADDING.top + INNER_H - ((avg - 1) / 4) * INNER_H;
              return b.avgStars == null ? "" : `${x},${y}`;
            })
            .filter(Boolean)
            .join(" ")}
          fill="none"
          stroke="var(--color-berry)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          opacity={0.85}
        />
        {/* Dots on the polyline */}
        {data.monthly.map((b, i) => {
          if (b.avgStars == null) return null;
          const x =
            PADDING.left +
            i * (INNER_W / data.monthly.length) +
            barWidth / 2 +
            2;
          const y = PADDING.top + INNER_H - ((b.avgStars - 1) / 4) * INNER_H;
          return (
            <circle
              key={b.month}
              cx={x}
              cy={y}
              r={2.5}
              fill="var(--color-berry)"
            />
          );
        })}

        {/* Y-axis labels */}
        <text
          x={4}
          y={PADDING.top + 4}
          fontSize={9}
          fontFamily="var(--font-mono)"
          fill="var(--color-text-3)"
        >
          {labels.yAxisCount}
        </text>
        <text
          x={WIDTH - 4}
          y={PADDING.top + 4}
          textAnchor="end"
          fontSize={9}
          fontFamily="var(--font-mono)"
          fill="var(--color-text-3)"
        >
          {labels.yAxisStars}
        </text>
      </svg>

      {data.lastUpdatedAt ? (
        <p
          style={{
            margin: "10px 0 0",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--color-text-3)",
          }}
        >
          {labels.lastUpdated.replace(
            "{relative}",
            relativeAgo(new Date(data.lastUpdatedAt)),
          )}
        </p>
      ) : null}
    </Card>
  );
}

function Card({
  labels,
  children,
}: {
  labels: ReviewTrendCardLabels;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="review-trend-heading"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 4,
        }}
      >
        <h2
          id="review-trend-heading"
          style={{
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontSize: 16,
            color: "var(--color-text)",
          }}
        >
          {labels.title}
        </h2>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--color-text-3)",
          }}
        >
          {labels.eyebrow}
        </p>
      </div>
      {children}
    </section>
  );
}

function relativeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) {
    const hours = Math.floor(ms / 3_600_000);
    return hours <= 1 ? "just now" : `${hours}h ago`;
  }
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}
