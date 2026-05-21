/**
 * ServiceTemplateStrip · "Start a list from a service you sell".
 *
 * Top-of-page strip with 8 quick-start template cards. Each card links
 * to `/search?template={key}` — Hunter (F.2) reads the query param and
 * pre-fills the matching filter signals. F.2 isn't built yet so the
 * link points at `/search` (which 404s today); that's acceptable for a
 * scaffold landing.
 *
 * Per `.claude/rules/ui-ux-agency.md`: dense grid, mono labels, hover
 * lifts to indigo. Glyph emoji are allow-listed for service-category
 * badges per `copy-voice.md`.
 */

import * as React from "react";

import { Link } from "@/i18n/navigation";

import {
  SERVICE_TEMPLATES,
  type ServiceTemplateDescriptor,
} from "../service-templates";

export interface ServiceTemplateStripProps {
  heading: string;
  subheading: string;
  /** Pre-resolved label per template key (from i18n). */
  templateLabels: Record<ServiceTemplateDescriptor["key"], string>;
  /** Pre-resolved meta line per template key. */
  templateMetas: Record<ServiceTemplateDescriptor["key"], string>;
}

export function ServiceTemplateStrip({
  heading,
  subheading,
  templateLabels,
  templateMetas,
}: ServiceTemplateStripProps) {
  return (
    <section
      aria-labelledby="service-templates-heading"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "18px 22px",
        marginBottom: 22,
        boxShadow: "0 1px 2px rgba(15, 17, 34, .04)",
      }}
    >
      <h2
        id="service-templates-heading"
        style={{
          margin: "0 0 6px",
          fontSize: 14,
          fontWeight: 600,
          color: "var(--color-text)",
        }}
      >
        {heading}
      </h2>
      <p
        style={{
          margin: "0 0 14px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-text-3)",
        }}
      >
        {subheading}
      </p>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 10,
        }}
      >
        {SERVICE_TEMPLATES.map((tpl) => (
          <li key={tpl.key}>
            <Link
              href={{
                // `/hunter` is locale-mapped in i18n/routing.ts. F.2
                // reads `?template=` and pre-fills the matching filter
                // signals on step 1 of the Hunter flow.
                pathname: "/hunter",
                query: { template: tpl.key },
              }}
              style={{
                display: "block",
                padding: "14px 14px",
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                background: "var(--color-bg-2)",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span
                aria-hidden
                style={{
                  fontSize: 18,
                  marginBottom: 8,
                  display: "block",
                  lineHeight: 1,
                }}
              >
                {tpl.glyph}
              </span>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  marginBottom: 3,
                  color: "var(--color-text)",
                }}
              >
                {templateLabels[tpl.key]}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--color-text-3)",
                }}
              >
                {templateMetas[tpl.key]}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
