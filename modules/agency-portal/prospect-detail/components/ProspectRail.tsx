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
  noInstagram: string;
  /** Pill label rendered next to a verified email · "Verified". */
  emailVerifiedPill: string;
  /** Tooltip / aria-label for the verified pill — explains the source. */
  emailVerifiedAria: (iso: string) => string;
  /** Locale-formatted follower count · "12.4k followers". */
  instagramFollowersLabel: (count: number) => string;
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
        <div style={{ display: "grid", gap: 10 }}>
          <ContactLine
            label="phone"
            value={prospect.phone}
            fallback={labels.noPhone}
          />
          <EmailLine
            email={prospect.email}
            emailVerifiedAt={prospect.emailVerifiedAt}
            fallback={labels.noEmail}
            verifiedPill={labels.emailVerifiedPill}
            verifiedAria={labels.emailVerifiedAria}
          />
          <InstagramLine
            handle={prospect.instagramHandle}
            followers={prospect.instagramFollowers}
            fallback={labels.noInstagram}
            followersLabel={labels.instagramFollowersLabel}
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

/**
 * EmailLine · contact-rail row for the owner email + verified pill.
 *
 * Renders the email as a mailto-link in indigo when present, plus a
 * "Verified" pill in agency-teal when `emailVerifiedAt` is non-null.
 * Tom uses this to pick which prospects to start drafting outreach
 * against — verified emails are the bottom of the pyramid (highest-
 * intent to convert per pitch attempt).
 */
function EmailLine({
  email,
  emailVerifiedAt,
  fallback,
  verifiedPill,
  verifiedAria,
}: {
  email: string | null;
  emailVerifiedAt: string | null;
  fallback: string;
  verifiedPill: string;
  verifiedAria: (iso: string) => string;
}) {
  if (!email) {
    return (
      <div
        style={{
          fontSize: 12,
          color: "var(--color-text-3)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <span style={labelStyle()}>email</span> · {fallback}
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
      <span style={labelStyle()}>email</span>
      <br />
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <a
          href={`mailto:${email}`}
          style={{
            color: "var(--color-agency-indigo)",
            fontWeight: 600,
            textDecoration: "none",
            wordBreak: "break-word",
          }}
        >
          {email}
        </a>
        {emailVerifiedAt ? (
          <span
            aria-label={verifiedAria(emailVerifiedAt)}
            title={verifiedAria(emailVerifiedAt)}
            data-testid="prospect-email-verified-pill"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(8,145,178,.10)",
              color: "var(--color-agency-teal)",
              border: "1px solid rgba(8,145,178,.20)",
              lineHeight: 1.3,
              whiteSpace: "nowrap",
            }}
          >
            {verifiedPill}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * InstagramLine · contact-rail row for the @handle + follower count.
 *
 * Follower count is mono uppercase below the handle so Tom can scan
 * the "is this a real account vs ghost profile" tell at a glance.
 */
function InstagramLine({
  handle,
  followers,
  fallback,
  followersLabel,
}: {
  handle: string | null;
  followers: number | null;
  fallback: string;
  followersLabel: (count: number) => string;
}) {
  if (!handle) {
    return (
      <div
        style={{
          fontSize: 12,
          color: "var(--color-text-3)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <span style={labelStyle()}>instagram</span> · {fallback}
      </div>
    );
  }
  // Strip a leading "@" if present so the deep-link is clean.
  const cleanHandle = handle.startsWith("@") ? handle.slice(1) : handle;
  return (
    <div style={{ fontSize: 13, color: "var(--color-text)" }}>
      <span style={labelStyle()}>instagram</span>
      <br />
      <a
        href={`https://instagram.com/${cleanHandle}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: "var(--color-agency-indigo)",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        @{cleanHandle}
      </a>
      {followers != null && followers > 0 ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-text-3)",
            marginTop: 2,
            fontVariantNumeric: "tabular-nums",
          }}
          data-testid="prospect-instagram-followers"
        >
          {followersLabel(followers)}
        </div>
      ) : null}
    </div>
  );
}
