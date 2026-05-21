import * as React from "react";

import type { ProspectRecord } from "../types";

/**
 * ProspectHero · `/(agency)/prospect/[businessId]` hero card.
 *
 * Per `_design/agency/prospect.html` + `.claude/rules/ui-ux-agency.md`:
 *
 *   - Avatar + name + meta line (address · category · refreshed)
 *   - prev / next nav buttons
 *   - Mark-as-contacted / mark-as-client / generate one-pager actions
 *     (presentational v1 · F.7 + G.x wire the actions)
 *
 * Server-component-safe · pure presentational, no hooks. All copy is
 * pre-resolved via the `labels` prop so the caller (page) owns i18n.
 */

const AVATAR_TONES: Record<1 | 2 | 3 | 4 | 5 | 6 | 7, string> = {
  1: "linear-gradient(135deg, #6366f1, #4338ca)",
  2: "linear-gradient(135deg, #0ea5e9, #0369a1)",
  3: "linear-gradient(135deg, #14b8a6, #0f766e)",
  4: "linear-gradient(135deg, #f59e0b, #b45309)",
  5: "linear-gradient(135deg, #ec4899, #9d174d)",
  6: "linear-gradient(135deg, #8b5cf6, #5b21b6)",
  7: "linear-gradient(135deg, #ef4444, #991b1b)",
};

export interface ProspectHeroLabels {
  backToLists: string;
  prev: string;
  next: string;
  noPrev: string;
  noNext: string;
  markContacted: string;
  markClient: string;
  generateOnePager: string;
  refreshedAt: (iso: string) => string;
}

export interface ProspectHeroProps {
  prospect: ProspectRecord;
  labels: ProspectHeroLabels;
  /** Links rendered by the page (Link from i18n/navigation). */
  prevLink: React.ReactNode | null;
  nextLink: React.ReactNode | null;
  backLink: React.ReactNode;
  /**
   * One-pager PDF download URL (F.6). When provided, the
   * "Generate one-pager" button renders as a real `<a>` link that
   * streams an `application/pdf`. When omitted, the button stays
   * disabled (matches the v0 presentation).
   */
  onePagerHref?: string;
}

export function ProspectHero({
  prospect,
  labels,
  prevLink,
  nextLink,
  backLink,
  onePagerHref,
}: ProspectHeroProps) {
  return (
    <section
      aria-labelledby="prospect-hero-title"
      data-testid="prospect-hero"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "24px 28px",
        marginBottom: 22,
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <nav
        aria-label="Breadcrumb"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-text-3)",
          marginBottom: 14,
        }}
      >
        {backLink}
        <span aria-hidden="true" style={{ color: "var(--color-border)" }}>
          /
        </span>
        <span>{prospect.name}</span>
      </nav>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          gap: 18,
          alignItems: "center",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            background: AVATAR_TONES[prospect.avatarTone],
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontWeight: 800,
            fontSize: 18,
            letterSpacing: "-0.01em",
          }}
        >
          {prospect.avatarInitials}
        </div>

        <div>
          <h1
            id="prospect-hero-title"
            style={{
              margin: 0,
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--color-text)",
            }}
          >
            {prospect.name}
          </h1>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              color: "var(--color-text-3)",
              marginTop: 6,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {prospect.address ? <span>{prospect.address}</span> : null}
            {prospect.category ? <span>· {prospect.category}</span> : null}
            <span>· {labels.refreshedAt(prospect.refreshedAt)}</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {prevLink ?? (
            <span style={ghostBtnStyle(true)} aria-disabled="true">
              ← {labels.prev}
            </span>
          )}
          {nextLink ?? (
            <span style={ghostBtnStyle(true)} aria-disabled="true">
              {labels.next} →
            </span>
          )}
          <button
            type="button"
            disabled
            style={{
              ...ghostBtnStyle(false),
              background: "var(--color-warn-light, #fef3c7)",
              color: "var(--color-warn, #b45309)",
              borderColor: "rgba(217,119,6,.25)",
              cursor: "not-allowed",
              opacity: 0.85,
            }}
            data-testid="mark-contacted-btn"
          >
            {labels.markContacted}
          </button>
          <button
            type="button"
            disabled
            style={{
              ...ghostBtnStyle(false),
              background: "var(--color-success-light, #dcfce7)",
              color: "var(--color-success, #166534)",
              borderColor: "rgba(22,163,74,.25)",
              cursor: "not-allowed",
              opacity: 0.85,
            }}
            data-testid="mark-client-btn"
          >
            {labels.markClient}
          </button>
          {onePagerHref ? (
            <a
              href={onePagerHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "8px 14px",
                borderRadius: 8,
                background: "var(--color-agency-indigo)",
                color: "#fff",
                border: "1px solid var(--color-agency-indigo)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                textDecoration: "none",
              }}
              data-testid="generate-one-pager-btn"
            >
              {labels.generateOnePager}
            </a>
          ) : (
            <button
              type="button"
              disabled
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "8px 14px",
                borderRadius: 8,
                background: "var(--color-agency-indigo)",
                color: "#fff",
                border: "1px solid var(--color-agency-indigo)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "not-allowed",
                opacity: 0.85,
              }}
              data-testid="generate-one-pager-btn"
            >
              {labels.generateOnePager}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function ghostBtnStyle(asLinkPlaceholder: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 14px",
    borderRadius: 8,
    background: "var(--color-bg-2)",
    border: "1px solid var(--color-border)",
    color: asLinkPlaceholder ? "var(--color-text-3)" : "var(--color-text)",
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: asLinkPlaceholder ? "default" : "pointer",
  };
}
