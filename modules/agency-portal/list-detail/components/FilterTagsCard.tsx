import * as React from "react";

import type { AgencyListDetailFilterTag } from "../types";

/**
 * FilterTagsCard · the "filters defining this list" card on
 * `/(agency)/lists/[id]`.
 *
 * Per `_design/agency/list-detail.html`:
 *
 *   - Mono uppercase label · "// Filters defining this list · {n} active"
 *   - Indigo chip for each filter · slight tint background
 *   - Trailing "Edit →" link that opens the Hunter to refine
 *
 * Server-component-safe · no hooks. The "Edit →" link is rendered by
 * the caller (it's a next-intl `Link` and we keep this component
 * locale-free).
 */

export interface FilterTagsCardLabels {
  heading: (count: number) => string;
  editAction: string;
  emptyFallback: string;
}

export interface FilterTagsCardProps {
  tags: ReadonlyArray<AgencyListDetailFilterTag>;
  labels: FilterTagsCardLabels;
  /**
   * The "Edit →" affordance · the page renders a next-intl `Link` and
   * passes it here so we stay locale-free in this leaf component.
   */
  editLink?: React.ReactNode;
}

export function FilterTagsCard({
  tags,
  labels,
  editLink,
}: FilterTagsCardProps) {
  return (
    <section
      aria-label={labels.heading(tags.length)}
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "16px 20px",
        marginBottom: 18,
      }}
      data-testid="filter-tags-card"
    >
      <header
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--color-text-3)",
          marginBottom: 10,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span>{labels.heading(tags.length)}</span>
        {editLink ?? null}
      </header>
      <div
        role="list"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        {tags.length === 0 ? (
          <span
            style={{
              fontSize: 12,
              color: "var(--color-text-3)",
              fontStyle: "italic",
            }}
          >
            {labels.emptyFallback}
          </span>
        ) : (
          tags.map((tag) => (
            <span
              key={tag.id}
              role="listitem"
              data-tag-exclude={tag.exclude ? "true" : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                padding: "5px 10px",
                background: tag.exclude
                  ? "rgba(181,61,71,.12)"
                  : "rgba(91,61,245,.10)",
                color: tag.exclude
                  ? "var(--color-alert)"
                  : "var(--color-agency-indigo)",
                borderRadius: 6,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {tag.label}
            </span>
          ))
        )}
      </div>
    </section>
  );
}
