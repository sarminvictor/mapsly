// modules/smb-reviews/components/ServiceMentionsCard.tsx
//
// R.6 · "Your services in reviews" comparator.
// For each active service, shows how many times it's been mentioned in
// the last 12 months + a "stale" tip when last-mentioned is > 3 months.

import type { ServiceMention } from "@/modules/reviews/trends";

export interface ServiceMentionsCardLabels {
  title: string;
  subtitle: string;
  empty: string;
  /** "Mentioned {count} times" */
  countLabel: string;
  /** "Not in 3+ months" */
  staleLabel: string;
  /** "Never mentioned" — for services with count===0 */
  neverLabel: string;
}

interface Props {
  services: ServiceMention[];
  labels: ServiceMentionsCardLabels;
}

export function ServiceMentionsCard({ services, labels }: Props) {
  if (services.length === 0) {
    return (
      <Card labels={labels}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-2)" }}>
          {labels.empty}
        </p>
      </Card>
    );
  }

  // Sort: stale services first (so Maria sees what needs attention), then
  // by mention count descending.
  const sorted = [...services].sort((a, b) => {
    if (a.isStale !== b.isStale) return a.isStale ? -1 : 1;
    return b.count - a.count;
  });

  return (
    <Card labels={labels}>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {sorted.map((s) => (
          <li
            key={s.name}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "8px 0",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 14,
                  color: "var(--color-text)",
                  fontWeight: 500,
                  textTransform: "capitalize",
                }}
              >
                {s.name}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: s.isStale
                    ? "var(--color-coral)"
                    : "var(--color-text-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginTop: 2,
                }}
              >
                {s.count === 0
                  ? labels.neverLabel
                  : s.isStale
                    ? labels.staleLabel
                    : labels.countLabel.replace("{count}", String(s.count))}
              </div>
            </div>
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 22,
                color:
                  s.count === 0
                    ? "var(--color-text-3)"
                    : s.isStale
                      ? "var(--color-coral)"
                      : "var(--color-text)",
                fontWeight: 600,
              }}
            >
              {s.count}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Card({
  labels,
  children,
}: {
  labels: ServiceMentionsCardLabels;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="service-mentions-heading"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "16px 18px",
      }}
    >
      <h2
        id="service-mentions-heading"
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
