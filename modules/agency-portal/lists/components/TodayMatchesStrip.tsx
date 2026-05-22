/**
 * TodayMatchesStrip · "X new leads this week across N active lists".
 *
 * Hero strip at the top of the lists page. Per
 * `_design/agency/lists.html` this is the first thing Tom sees after
 * the sidebar, anchoring the page on "what happened overnight."
 *
 * For F.1 we use a 7-day window (matches `getAgencyListsData`'s
 * `newThisWeekCount` aggregate) rather than strict "today" — the
 * weekly cron writes the data, so a literal "today" number would be
 * empty until the cron lands. The copy honestly says "this week."
 */

import * as React from "react";

import { Link } from "@/i18n/navigation";

export interface TodayMatchesStripProps {
  /** Bold leading number · sum of newThisWeekCount across active lists. */
  total: number;
  /** Eyebrow label · already pluralised + i18n-resolved. */
  label: string;
  /** Body copy · already i18n-resolved with totals injected. */
  detail: string;
  /** Meta footer · last-refresh fragment. */
  meta: string;
  /** CTA · "Review →" links to the Activity page (built later). */
  cta: { href: "/lists" | "/search"; label: string };
  /**
   * Optional secondary KPI · "X verified email" — Tom's outreach
   * primer. Omitted when 0 across all active lists so the strip stays
   * tight when the email-verify cron hasn't run yet.
   */
  verifiedEmail?: { count: number; label: string } | null;
}

export function TodayMatchesStrip({
  total,
  label,
  detail,
  meta,
  cta,
  verifiedEmail,
}: TodayMatchesStripProps) {
  return (
    <section
      aria-label={label}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 18,
        alignItems: "center",
        padding: "18px 22px",
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        marginBottom: 22,
        boxShadow: "0 1px 2px rgba(15, 17, 34, .04)",
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--color-text-3)",
            marginBottom: 4,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 42,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            color: "var(--color-agency-indigo)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {total}
        </div>
      </div>
      <div>
        <p
          style={{
            margin: 0,
            fontSize: 13.5,
            color: "var(--color-text)",
            lineHeight: 1.5,
          }}
        >
          {detail}
        </p>
        {verifiedEmail && verifiedEmail.count > 0 ? (
          <p
            style={{
              margin: "6px 0 0",
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              fontWeight: 600,
              color: "var(--color-agency-teal)",
            }}
            data-testid="today-strip-verified-email"
          >
            {verifiedEmail.label}
          </p>
        ) : null}
        <p
          style={{
            margin: "6px 0 0",
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: "var(--color-text-3)",
          }}
        >
          {meta}
        </p>
      </div>
      <Link
        href={{ pathname: cta.href }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "10px 16px",
          borderRadius: 8,
          background: "var(--color-agency-indigo)",
          color: "#fff",
          fontWeight: 600,
          fontSize: 13,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        {cta.label}
      </Link>
    </section>
  );
}
