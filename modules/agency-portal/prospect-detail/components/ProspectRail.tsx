import * as React from "react";

import type { ProspectRecord } from "../types";

/**
 * ProspectRail · right-side rail with contact, "appears in", notes,
 * data sources.
 *
 * Per `_design/agency/prospect.html`: contact card → appears-in →
 * notes (read-only v1; F.7 wires save) → data sources / refreshed.
 *
 * Notes block is read-only static text for v1 (display reminder only)
 * — wiring the persisted note write is a follow-up server action.
 */

export interface ProspectRailLabels {
  contactTitle: string;
  appearsInTitle: string;
  appearsInEmpty: string;
  dataSourcesTitle: string;
  refreshedAt: (iso: string) => string;
  notesTitle: string;
  notesPlaceholder: string;
  notesSavePending: string;
  noPhone: string;
  noEmail: string;
  noWebsite: string;
}

export interface ProspectRailProps {
  prospect: ProspectRecord;
  labels: ProspectRailLabels;
  /** Pre-built locale-aware list links rendered by the page. */
  appearsInLinks: React.ReactNode[];
}

export function ProspectRail({
  prospect,
  labels,
  appearsInLinks,
}: ProspectRailProps) {
  return (
    <aside
      aria-label={labels.contactTitle}
      data-testid="prospect-rail"
      style={{ display: "grid", gap: 16, alignContent: "start" }}
    >
      {/* Contact card */}
      <div
        style={{
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          padding: "18px 20px",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 14,
            color: "var(--color-text)",
          }}
        >
          {labels.contactTitle}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <ContactLine
            label="phone"
            value={prospect.phone}
            fallback={labels.noPhone}
          />
          <ContactLine
            label="website"
            value={prospect.websiteUrl}
            fallback={labels.noWebsite}
            isLink
          />
        </div>
      </div>

      {/* Appears in */}
      <div
        style={{
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          padding: "18px 20px",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 12,
            color: "var(--color-text)",
          }}
        >
          {labels.appearsInTitle}
        </div>
        {appearsInLinks.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--color-text-3)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {labels.appearsInEmpty}
          </div>
        ) : (
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gap: 8,
            }}
          >
            {appearsInLinks.map((link, idx) => (
              <li key={idx} style={{ fontSize: 13 }}>
                {link}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Notes (read-only v1) */}
      <div
        style={{
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          padding: "18px 20px",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 10,
            color: "var(--color-text)",
          }}
        >
          {labels.notesTitle}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--color-text-3)",
            lineHeight: 1.5,
            fontFamily: "var(--font-mono)",
            padding: "10px 12px",
            background: "var(--color-bg-3, #f3f4f6)",
            borderRadius: 8,
          }}
        >
          {labels.notesPlaceholder}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--color-text-3)",
            marginTop: 8,
            fontFamily: "var(--font-mono)",
          }}
        >
          {labels.notesSavePending}
        </div>
      </div>

      {/* Data sources */}
      <div
        style={{
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          padding: "18px 20px",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 12,
            color: "var(--color-text)",
          }}
        >
          {labels.dataSourcesTitle}
        </div>
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: 8,
          }}
        >
          {prospect.dataSources.map((s, idx) => (
            <li
              key={`${s.label}-${idx}`}
              style={{
                fontSize: 12,
                color: "var(--color-text-2)",
                fontFamily: "var(--font-mono)",
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span>{s.label}</span>
              <span style={{ color: "var(--color-text-3)" }}>
                {labels.refreshedAt(s.refreshedAt)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function ContactLine({
  label,
  value,
  fallback,
  isLink,
}: {
  label: string;
  value: string | null;
  fallback: string;
  isLink?: boolean;
}) {
  if (!value) {
    return (
      <div
        style={{
          fontSize: 12,
          color: "var(--color-text-3)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <span style={labelStyle()}>{label}</span> · {fallback}
      </div>
    );
  }
  return (
    <div
      style={{
        fontSize: 13,
        color: "var(--color-text)",
        wordBreak: "break-word",
      }}
    >
      <span style={labelStyle()}>{label}</span>
      <br />
      {isLink ? (
        <a
          href={value.startsWith("http") ? value : `https://${value}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "var(--color-agency-indigo)",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {value}
        </a>
      ) : (
        <span style={{ fontFamily: "var(--font-mono)" }}>{value}</span>
      )}
    </div>
  );
}

function labelStyle(): React.CSSProperties {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--color-text-3)",
  };
}
