"use client";

// EnrichMoreHost · WP5-3 · the single mount point for the EnrichMoreSheet.
// Lives in WorkbenchShell (NOT inside LeadsWorkbench — that file's chrome is
// owned elsewhere) and listens on the enrich-sheet bus, so any surface in the
// workbench tree (coverage CTA, drawer ghost accordions, locked Fields rows)
// opens the sheet with ONE `openEnrichSheet(...)` call. Pattern 4-safe: only
// plain props cross from the server pages.

import { useEffect, useState } from "react";

import {
  subscribeEnrichSheet,
  type EnrichSheetRequest,
} from "../enrich-sheet-bus";
import type { EnrichmentTypeKey, TypeState } from "../family-coverage";
import { EnrichMoreSheet } from "./EnrichMoreSheet";

export function EnrichMoreHost({
  discoveryId,
  coverageTypeStates = {},
}: {
  discoveryId: string;
  /**
   * The SAME per-business per-TYPE run-state map the page hands LeadsWorkbench
   * (Pattern 4 — plain data). Threaded through so the sheet can show, per data
   * GROUP, "N have · M to get" over the scope's leads instead of quoting blind.
   * A business missing from the map is treated as fully not-run in the sheet.
   */
  coverageTypeStates?: Record<string, Record<EnrichmentTypeKey, TypeState>>;
}) {
  const [request, setRequest] = useState<EnrichSheetRequest | null>(null);

  useEffect(() => subscribeEnrichSheet((req) => setRequest(req)), []);

  if (!request) return null;
  return (
    <EnrichMoreSheet
      discoveryId={discoveryId}
      request={request}
      coverageTypeStates={coverageTypeStates}
      onClose={() => setRequest(null)}
    />
  );
}
