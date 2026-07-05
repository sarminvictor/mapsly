"use client";

// FieldsMenuExtras · WP5-13 · the Fields-▾-menu buy-rows, built as a
// self-contained child so the LeadsWorkbench edit stays minimal/additive:
//
//   `FieldsMenuLockedRows` — the "Not enriched — runs a research" group
//   (prototype .locked rows): each still-missing data family renders as a
//   locked buy-row whose click opens the WP5-3 EnrichMoreSheet pre-seeded
//   with the family's enrichment types. Columns + purchase in one mental model.
//
// (U15 removed `FieldFunnel` — the Fields menu is column-visibility only now;
// filters live exclusively in the merged "+ Filter" picker.)
//
// Per .claude/rules/ui-ux-agency.md: dense, jargon-OK. English-only.

import type { EnrichmentType } from "@/modules/cost/pricing";
import { DATA_FAMILIES, type DataFamily } from "../leads-workbench";
import { enrichTypesForFamilies } from "../family-coverage";
import { openEnrichSheet, type EnrichSheetScope } from "../enrich-sheet-bus";

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
