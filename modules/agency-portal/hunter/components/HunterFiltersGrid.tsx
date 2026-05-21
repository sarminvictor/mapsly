/**
 * HunterFiltersGrid · Step 3 of the Hunter flow.
 *
 * Renders the 60+ signal filters from the D.1 registry, grouped by the
 * 8 canonical categories (CATEGORIES_ORDERED). Each filter row shows:
 *
 *   - signal label + plain-English help tooltip (Tom-friendly even
 *     though Tom knows the jargon — copy-voice rules)
 *   - comparator preview (read-only in this slice)
 *   - default value preview
 *   - unit suffix (%, ms, s, etc.)
 *
 * F.2.2 will replace the static rows with `<FilterRow>` from
 * `modules/agency-portal/components/FilterRow.tsx` and wire active-state +
 * value-edit handlers. For the scaffold we render a compact static
 * version so the page is type-clean and the registry shape is visible
 * to Tom.
 */

import * as React from "react";

import type { CategoryDefinition } from "@/modules/signals";
import type { SignalDefinition } from "@/modules/signals";

export interface HunterFiltersGridLabels {
  heading: string;
  subheading: string;
  readonlyNotice: string;
  backCta: string;
}

export interface HunterFiltersGridGroup {
  category: CategoryDefinition;
  signals: readonly SignalDefinition[];
}

export interface HunterFiltersGridProps {
  groups: readonly HunterFiltersGridGroup[];
  labels: HunterFiltersGridLabels;
}

function formatValue(s: SignalDefinition): string {
  const v = s.defaultValue;
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "YES" : "NO";
  if (typeof v === "number") {
    return `${v}${s.valueUnit ? ` ${s.valueUnit}` : ""}`;
  }
  return String(v);
}

function defaultComparator(s: SignalDefinition): string {
  // Comparator preview · use first allowed comparator as a sensible default
  return String(s.comparators[0] ?? "=");
}

export function HunterFiltersGrid({
  groups,
  labels,
}: HunterFiltersGridProps) {
  const totalSignals = groups.reduce((sum, g) => sum + g.signals.length, 0);

  return (
    <section
      aria-labelledby="hunter-step3-heading"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "20px 22px",
        boxShadow: "0 1px 2px rgba(15, 17, 34, .04)",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <h2
          id="hunter-step3-heading"
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: "var(--color-text)",
          }}
        >
          {labels.heading}
        </h2>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--color-text-3)",
          }}
        >
          {totalSignals} signals
        </span>
      </header>
      <p
        style={{
          margin: "0 0 12px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-text-3)",
        }}
      >
        {labels.subheading}
      </p>

      <div
        role="status"
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px dashed rgba(91,61,245,0.30)",
          background: "rgba(91,61,245,0.04)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-agency-indigo)",
          marginBottom: 18,
        }}
      >
        {labels.readonlyNotice}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {groups.map(({ category, signals }) => {
          if (signals.length === 0) return null;
          return (
            <section
              key={category.key}
              aria-labelledby={`hunter-cat-${category.key}`}
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                background: "var(--color-bg)",
                overflow: "hidden",
              }}
            >
              <header
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--color-border)",
                  background: "var(--color-bg-2)",
                }}
              >
                <span
                  id={`hunter-cat-${category.key}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
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
                      background: category.colorHint,
                      flexShrink: 0,
                    }}
                  />
                  {category.label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--color-text-3)",
                  }}
                >
                  {signals.length}
                </span>
              </header>
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                }}
              >
                {signals.map((s) => (
                  <li
                    key={s.key}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto auto",
                      gap: 12,
                      alignItems: "center",
                      padding: "10px 14px",
                      borderTop: "1px solid var(--color-border)",
                      fontFamily: "var(--font-sans)",
                      fontSize: 13,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          color: "var(--color-text)",
                          fontWeight: 500,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {s.label}
                      </div>
                      <div
                        title={s.helpTooltip}
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          color: "var(--color-text-3)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          marginTop: 2,
                        }}
                      >
                        {s.helpTooltip}
                      </div>
                    </div>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--color-text-2)",
                        padding: "3px 7px",
                        background: "var(--color-bg-2)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 4,
                      }}
                    >
                      {defaultComparator(s)}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--color-text)",
                        minWidth: 56,
                        textAlign: "right",
                      }}
                    >
                      {formatValue(s)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}
