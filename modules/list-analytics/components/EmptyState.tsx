import * as React from "react";

/**
 * EmptyState · shown when the agency has zero lists or zero leads.
 *
 * Per `.claude/rules/ui-ux-agency.md` empty-state copy is terser than
 * SMB · "No leads yet. Create a list via Search." not "Looks like
 * there's nothing here yet, please consider creating a list."
 *
 * Server-component-safe. Pure presentational, no hooks.
 */

export interface EmptyStateLabels {
  title: string;
  body: string;
  ctaLabel: string;
}

export interface EmptyStateProps {
  labels: EmptyStateLabels;
  /** Pre-resolved CTA href (typically the search / hunter route). */
  ctaHref: string;
}

export function EmptyState({ labels, ctaHref }: EmptyStateProps) {
  return (
    <section
      data-testid="list-analytics-empty-state"
      style={{
        background: "var(--color-bg-2)",
        border: "1px dashed var(--color-border)",
        borderRadius: 14,
        padding: "40px 24px",
        textAlign: "center",
        marginBottom: 22,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 18,
          fontWeight: 600,
          color: "var(--color-text)",
        }}
      >
        {labels.title}
      </h2>
      <p
        style={{
          margin: "8px auto 18px",
          maxWidth: 520,
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--color-text-2)",
        }}
      >
        {labels.body}
      </p>
      <a
        href={ctaHref}
        data-testid="list-analytics-empty-cta"
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "10px 18px",
          borderRadius: 8,
          background: "var(--color-agency-indigo)",
          color: "#fff",
          fontWeight: 600,
          fontSize: 13,
          textDecoration: "none",
        }}
      >
        {labels.ctaLabel}
      </a>
    </section>
  );
}
