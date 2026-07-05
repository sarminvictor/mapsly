"use client";

// FieldsMenuExtras · WP5-13 · the Fields-▾-menu buy-rows, built as a
// self-contained child so the LeadsWorkbench edit stays minimal/additive:
//
//   `FieldsMenuLockedRows` — the "Not enriched — runs a research" group
//   (prototype .locked rows): each still-missing DATA GROUP renders as a
//   locked buy-row whose click opens the WP5-3 EnrichMoreSheet pre-seeded
//   with that group. Columns + purchase in one mental model.
//
// (U15 removed `FieldFunnel` — the Fields menu is column-visibility only now;
// filters live exclusively in the merged "+ Filter" picker.)
//
// C3 · speaks the ONE data-group vocabulary (7 groups Tom gets), not the 9
// billing jobs — same axis as the coverage panel + row chip strip + badge.
//
// Per .claude/rules/ui-ux-agency.md: dense, jargon-OK. English-only.

import type { EnrichmentType } from "@/modules/cost/pricing";
import {
  DATA_GROUPS,
  enrichTypesForGroups,
  type DataGroupKey,
} from "../family-coverage";
import { openEnrichSheet, type EnrichSheetScope } from "../enrich-sheet-bus";

/**
 * The locked "Not enriched" rows: one per DATA GROUP still missing across the
 * visible set. Clicking one opens the EnrichMoreSheet pre-seeded with that
 * group's enrichment types + the caller's current scope. Renders nothing when
 * everything is covered (the group header would be noise).
 */
export function FieldsMenuLockedRows({
  missing,
  scope,
}: {
  missing: readonly DataGroupKey[];
  scope: EnrichSheetScope;
}) {
  const rows = DATA_GROUPS.filter((g) => missing.includes(g.key));
  if (rows.length === 0) return null;

  return (
    <>
      <div className="cgrp">Not enriched — runs a research</div>
      {rows.map((g) => {
        const open = () =>
          openEnrichSheet({
            enrichments: enrichTypesForGroups([g.key]) as EnrichmentType[],
            scope,
          });
        return (
          <label
            key={g.key}
            className="locked"
            onClick={(e) => {
              // The whole row is a buy surface — never a checkbox toggle.
              e.preventDefault();
              e.stopPropagation();
              open();
            }}
          >
            <input type="checkbox" checked={false} readOnly />
            {g.label} <span className="seg-tag raw">RAW</span>
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
