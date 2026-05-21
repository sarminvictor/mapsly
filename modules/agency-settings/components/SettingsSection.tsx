/**
 * Agency settings · reusable section card.
 *
 * Pure server component · zero state · zero events. Renders one
 * indigo-accented card with a heading + optional subtitle + body
 * children. Used by every section on `/(agency)/settings/page.tsx` so
 * the spacing + border treatment stays consistent.
 *
 * Tom voice per `.claude/rules/ui-ux-agency.md` § Visual language: tight
 * type, generous border-radius, cool gray base + indigo accents from
 * `--color-agency-indigo`.
 */

import type { CSSProperties, ReactNode } from "react";

interface SettingsSectionProps {
  /** Plain-string heading id. Used for aria-labelledby. */
  headingId: string;
  /** Section heading text. */
  heading: string;
  /** Optional one-line subtitle below the heading. */
  subtitle?: string;
  /** Section body · forms, lists, links. */
  children: ReactNode;
  /** Optional trailing element (e.g. plan pill in the Plan section). */
  trailing?: ReactNode;
}

export function SettingsSection({
  headingId,
  heading,
  subtitle,
  children,
  trailing,
}: SettingsSectionProps) {
  return (
    <section aria-labelledby={headingId} style={cardStyle}>
      <header style={headerStyle}>
        <div style={{ minWidth: 0 }}>
          <h2 id={headingId} style={titleStyle}>
            {heading}
          </h2>
          {subtitle ? <p style={subtitleStyle}>{subtitle}</p> : null}
        </div>
        {trailing ? <div style={{ flex: "0 0 auto" }}>{trailing}</div> : null}
      </header>
      <div style={bodyStyle}>{children}</div>
    </section>
  );
}

const cardStyle: CSSProperties = {
  background: "var(--color-bg-2)",
  border: "1px solid var(--color-border)",
  borderRadius: 16,
  padding: "24px 22px",
  marginBottom: 16,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 12,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 600,
  letterSpacing: "-0.005em",
  color: "var(--color-text)",
};

const subtitleStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: 13.5,
  lineHeight: 1.5,
  color: "var(--color-text-2)",
};

const bodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};
