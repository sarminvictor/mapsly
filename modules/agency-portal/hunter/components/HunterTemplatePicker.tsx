/**
 * HunterTemplatePicker · Step 1 of the Hunter flow.
 *
 * Grid of the 8 SERVICE_TEMPLATES (defined in
 * `modules/agency-portal/lists/service-templates.ts`). Each card is a
 * locale-aware `Link` to `?template={key}&step=2`. Active template (if
 * one was already selected via query param) gets indigo accent.
 *
 * Server component. Per `.claude/rules/ui-ux-agency.md`: dense grid,
 * mono captions, hover state lifts to indigo. Glyph emoji are allow-
 * listed for service-category badges per `copy-voice.md`.
 */

import * as React from "react";

import { Link } from "@/i18n/navigation";
import type { ServiceTemplateDescriptor } from "@/modules/agency-portal/lists/service-templates";

export interface HunterTemplatePickerLabels {
  heading: string;
  subheading: string;
  templateLabels: Record<ServiceTemplateDescriptor["key"], string>;
  templateMetas: Record<ServiceTemplateDescriptor["key"], string>;
  continueCta: string;
}

export interface HunterTemplatePickerProps {
  templates: readonly ServiceTemplateDescriptor[];
  activeTemplateKey: string | null;
  labels: HunterTemplatePickerLabels;
}

export function HunterTemplatePicker({
  templates,
  activeTemplateKey,
  labels,
}: HunterTemplatePickerProps) {
  return (
    <section
      aria-labelledby="hunter-step1-heading"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "20px 22px",
        boxShadow: "0 1px 2px rgba(15, 17, 34, .04)",
      }}
    >
      <h2
        id="hunter-step1-heading"
        style={{
          margin: "0 0 6px",
          fontSize: 16,
          fontWeight: 600,
          color: "var(--color-text)",
        }}
      >
        {labels.heading}
      </h2>
      <p
        style={{
          margin: "0 0 16px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-text-3)",
        }}
      >
        {labels.subheading}
      </p>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 10,
        }}
      >
        {templates.map((tpl) => {
          const isActive = tpl.key === activeTemplateKey;
          return (
            <li key={tpl.key}>
              <Link
                href={{
                  pathname: "/hunter",
                  query: { template: tpl.key, step: "2" },
                }}
                aria-label={labels.templateLabels[tpl.key]}
                style={{
                  display: "block",
                  padding: "14px",
                  border: "1px solid",
                  borderColor: isActive
                    ? "var(--color-agency-indigo)"
                    : "var(--color-border)",
                  borderRadius: 10,
                  background: isActive
                    ? "rgba(91,61,245,0.06)"
                    : "var(--color-bg)",
                  textDecoration: "none",
                  color: "inherit",
                  boxShadow: isActive
                    ? "0 0 0 3px rgba(91,61,245,0.08)"
                    : "none",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    fontSize: 20,
                    display: "block",
                    lineHeight: 1,
                    marginBottom: 10,
                  }}
                >
                  {tpl.glyph}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--color-text)",
                    marginBottom: 4,
                  }}
                >
                  {labels.templateLabels[tpl.key]}
                </span>
                <span
                  style={{
                    display: "block",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    lineHeight: 1.4,
                    color: "var(--color-text-3)",
                  }}
                >
                  {labels.templateMetas[tpl.key]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
