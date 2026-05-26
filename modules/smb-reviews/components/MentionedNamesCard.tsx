// modules/smb-reviews/components/MentionedNamesCard.tsx
//
// R.6 · "Names your customers mention" card.
// Top 10 staff/provider names by mention count in the trailing 12mo.

import type { PersonMention } from "@/modules/reviews/trends";

export interface MentionedNamesCardLabels {
  title: string;
  subtitle: string;
  empty: string;
  /** "{count} mentions" — singular handled with `=1` plural ICU */
  countLabel: string;
}

interface Props {
  people: PersonMention[];
  labels: MentionedNamesCardLabels;
}

export function MentionedNamesCard({ people, labels }: Props) {
  if (people.length === 0) {
    return (
      <Card labels={labels}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-2)" }}>
          {labels.empty}
        </p>
      </Card>
    );
  }

  const max = Math.max(1, ...people.map((p) => p.count));

  return (
    <Card labels={labels}>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {people.map((p) => {
          const pct = (p.count / max) * 100;
          return (
            <li
              key={p.name}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "6px 0",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 14,
                    color: "var(--color-text)",
                    fontWeight: 500,
                    marginBottom: 4,
                  }}
                >
                  {p.name}
                </div>
                <div
                  style={{
                    height: 6,
                    background: "var(--color-bg-3)",
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: "var(--color-coral)",
                      opacity: 0.7,
                    }}
                  />
                </div>
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--color-text-2)",
                  minWidth: 24,
                  textAlign: "right",
                }}
              >
                {p.count}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Card({
  labels,
  children,
}: {
  labels: MentionedNamesCardLabels;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="mentioned-names-heading"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "16px 18px",
      }}
    >
      <h2
        id="mentioned-names-heading"
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
          margin: "4px 0 12px",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--color-text-3)",
        }}
      >
        {labels.subtitle}
      </p>
      {children}
    </section>
  );
}
