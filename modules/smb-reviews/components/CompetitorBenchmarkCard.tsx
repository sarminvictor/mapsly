// modules/smb-reviews/components/CompetitorBenchmarkCard.tsx
//
// R.5 · "How you compare" surface for the SMB /reviews page.
//
// Renders a compact table of top 10 local competitors (same category +
// city + country) with the focal business's rank surfaced clearly.
//
// Per `.claude/rules/ui-ux-smb.md`:
//   - Warm tone, plain-English labels (no MSI / SERP jargon)
//   - Big-number headline ("You're #14 of 47 spas in Calgary")
//   - Below-the-fold OK · this is supporting context, not first impression
//   - Mobile-stack cleanly · tap targets ≥ 44px
//
// Server component · receives pre-computed ranking from the page.

import type {
  CompetitorRankingResult,
  CompetitorRow,
} from "@/modules/scoring/competitor-ranking";

export interface CompetitorBenchmarkLabels {
  /** Eyebrow above the title. Plain "How you compare" not "MSI Rank". */
  eyebrow: string;
  /** Heading. e.g. "How you compare" */
  title: string;
  /** "You're #{rank} of {total} {category} in {city}" */
  positionLine: string;
  /** Empty state when no competitor data is available yet. */
  empty: string;
  /** Column headers. */
  colRank: string;
  colName: string;
  colScore: string;
  colRating: string;
  colReviews: string;
  colNew30d: string;
  colReplyRate: string;
  /** Suffix shown on the focal business row · "(you)". */
  youLabel: string;
}

interface CompetitorBenchmarkCardProps {
  data: CompetitorRankingResult;
  category: string;
  city: string;
  labels: CompetitorBenchmarkLabels;
}

export function CompetitorBenchmarkCard({
  data,
  category,
  city,
  labels,
}: CompetitorBenchmarkCardProps) {
  if (data.cellTotal === 0 || !data.focal) {
    return (
      <section
        aria-labelledby="competitor-benchmark-heading"
        style={{
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          padding: "16px 18px",
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
          {labels.eyebrow}
        </p>
        <h2
          id="competitor-benchmark-heading"
          style={{
            margin: "4px 0 8px",
            fontFamily: "var(--font-serif)",
            fontSize: 18,
            color: "var(--color-text)",
          }}
        >
          {labels.title}
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-2)" }}>
          {labels.empty}
        </p>
      </section>
    );
  }

  const positionLine = labels.positionLine
    .replace("{rank}", String(data.focal.rank))
    .replace("{total}", String(data.cellTotal))
    .replace("{category}", category.toLowerCase())
    .replace("{city}", city);

  return (
    <section
      aria-labelledby="competitor-benchmark-heading"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "18px 20px",
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
        {labels.eyebrow}
      </p>
      <h2
        id="competitor-benchmark-heading"
        style={{
          margin: "4px 0 0",
          fontFamily: "var(--font-serif)",
          fontSize: 20,
          color: "var(--color-text)",
        }}
      >
        {labels.title}
      </h2>
      <p
        style={{
          margin: "6px 0 16px",
          fontSize: 14,
          color: "var(--color-text-2)",
          lineHeight: 1.4,
        }}
      >
        {positionLine}
      </p>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            minWidth: 520,
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: "1px solid var(--color-border)",
                textAlign: "left",
              }}
            >
              <Th>{labels.colRank}</Th>
              <Th>{labels.colName}</Th>
              <Th align="right">{labels.colScore}</Th>
              <Th align="right">{labels.colRating}</Th>
              <Th align="right">{labels.colReviews}</Th>
              <Th align="right">{labels.colNew30d}</Th>
              <Th align="right">{labels.colReplyRate}</Th>
            </tr>
          </thead>
          <tbody>
            {data.top.map((row) => (
              <CompetitorRowView
                key={row.id}
                row={row}
                youLabel={labels.youLabel}
              />
            ))}
            {/* If the focal isn't in the top N, render a separator + the focal
                row so Maria can see her position. */}
            {data.focal && !data.top.some((r) => r.isFocal) ? (
              <>
                <tr aria-hidden>
                  <td colSpan={7} style={{ padding: "8px 0" }}>
                    <div
                      style={{
                        borderTop: "1px dashed var(--color-border)",
                        height: 0,
                      }}
                    />
                  </td>
                </tr>
                <CompetitorRowView
                  row={data.focal}
                  youLabel={labels.youLabel}
                />
              </>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CompetitorRowView({
  row,
  youLabel,
}: {
  row: CompetitorRow;
  youLabel: string;
}) {
  const isFocal = row.isFocal;
  return (
    <tr
      style={{
        background: isFocal ? "rgba(195,85,58,.08)" : "transparent",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <Td>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontWeight: isFocal ? 700 : 600,
            color: isFocal ? "var(--color-coral)" : "var(--color-text)",
          }}
        >
          #{row.rank}
        </span>
      </Td>
      <Td>
        <span
          style={{
            color: isFocal ? "var(--color-text)" : "var(--color-text-2)",
            fontWeight: isFocal ? 600 : 500,
          }}
        >
          {row.name}
        </span>
        {isFocal ? (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              marginLeft: 8,
              color: "var(--color-coral)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
            }}
          >
            {youLabel}
          </span>
        ) : null}
      </Td>
      <Td align="right">
        <span
          title={`Composite (0-100): ${row.score} · subs · rating=${row.subScores.rating.toFixed(2)} · reviews=${row.subScores.reviews.toFixed(2)} · velocity=${row.subScores.velocity.toFixed(2)} · reply=${row.subScores.reply.toFixed(2)}`}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            color: isFocal ? "var(--color-coral)" : "var(--color-text)",
            fontWeight: isFocal ? 700 : 600,
          }}
        >
          {row.score}
        </span>
      </Td>
      <Td align="right">{row.rating != null ? row.rating.toFixed(1) : "—"}</Td>
      <Td align="right">{row.reviewCount ?? 0}</Td>
      <Td align="right">{row.velocity30d}</Td>
      <Td align="right">
        {row.replyRate == null ? "—" : `${Math.round(row.replyRate * 100)}%`}
      </Td>
    </tr>
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
      style={{
        textAlign: align ?? "left",
        padding: "8px 10px",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        fontFamily: "var(--font-mono)",
        color: "var(--color-text-3)",
        fontWeight: 600,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        padding: "10px",
        textAlign: align ?? "left",
        color: "var(--color-text-2)",
      }}
    >
      {children}
    </td>
  );
}
