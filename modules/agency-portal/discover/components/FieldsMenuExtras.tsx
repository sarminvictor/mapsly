"use client";

// FieldsMenuExtras · WP5-13 · the two Fields-▾-menu additions, built as
// self-contained children so the LeadsWorkbench edit stays minimal/additive:
//
//   1. `FieldFunnel` — the per-field funnel button (prototype REC 1d, .ffil):
//      add/edit a filter on that field straight from the Fields menu.
//   2. `FieldsMenuLockedRows` — the "Not enriched — runs a research" group
//      (prototype .locked rows): each still-missing data family renders as a
//      locked buy-row whose click opens the WP5-3 EnrichMoreSheet pre-seeded
//      with the family's enrichment types. Columns + filters + purchase in one
//      mental model.
//
// Per .claude/rules/ui-ux-agency.md: dense, jargon-OK. English-only.

import type { EnrichmentType } from "@/modules/cost/pricing";
import {
  DATA_FAMILIES,
  type DataFamily,
  type NumericFilterField,
} from "../leads-workbench";
import { enrichTypesForFamilies } from "../family-coverage";
import { openEnrichSheet, type EnrichSheetScope } from "../enrich-sheet-bus";

/** The funnel glyph (prototype REC 1d). */
function FunnelIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 4h12L9.5 9v4l-3 1.5V9z" />
    </svg>
  );
}

/**
 * Per-field funnel button, rendered INSIDE the field's `<label>` row. The
 * click must not toggle the row's checkbox — `preventDefault` stops the
 * label's default activation, `stopPropagation` keeps the menu open.
 */
export function FieldFunnel({
  field,
  label,
  active,
  onOpen,
}: {
  field: NumericFilterField;
  label: string;
  /** A filter on this field is already applied (fills the button). */
  active: boolean;
  /** Open the filter editor pre-set to this field. */
  onOpen: (field: NumericFilterField) => void;
}) {
  return (
    <button
      type="button"
      className={`ffil${active ? " on" : ""}`}
      title={`Filter on ${label}`}
      aria-label={`Filter on ${label}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen(field);
      }}
    >
      <FunnelIcon />
    </button>
  );
}

/**
 * The locked "Not enriched" rows: one per data family still missing across the
 * visible set. Clicking one opens the EnrichMoreSheet pre-seeded with that
 * family's enrichment types + the caller's current scope. Renders nothing when
 * everything is covered (the group header would be noise).
 */
export function FieldsMenuLockedRows({
  missing,
  scope,
}: {
  missing: readonly DataFamily[];
  scope: EnrichSheetScope;
}) {
  const rows = DATA_FAMILIES.filter(
    (f) => f.key !== "identity" && missing.includes(f.key),
  );
  if (rows.length === 0) return null;

  return (
    <>
      <div className="cgrp">Not enriched — runs a research</div>
      {rows.map((f) => {
        const open = () =>
          openEnrichSheet({
            enrichments: enrichTypesForFamilies([f.key]) as EnrichmentType[],
            scope,
          });
        return (
          <label
            key={f.key}
            className="locked"
            onClick={(e) => {
              // The whole row is a buy surface — never a checkbox toggle.
              e.preventDefault();
              e.stopPropagation();
              open();
            }}
          >
            <input type="checkbox" checked={false} readOnly />
            {f.label} <span className="seg-tag raw">RAW</span>
            <span className="clk">Enrich →</span>
            <span className="cnote">
              runs for the leads in view (or your selection)
            </span>
          </label>
        );
      })}
    </>
  );
}
