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
import { EnrichMoreSheet } from "./EnrichMoreSheet";

export function EnrichMoreHost({ discoveryId }: { discoveryId: string }) {
  const [request, setRequest] = useState<EnrichSheetRequest | null>(null);

  useEffect(() => subscribeEnrichSheet((req) => setRequest(req)), []);

  if (!request) return null;
  return (
    <EnrichMoreSheet
      discoveryId={discoveryId}
      request={request}
      onClose={() => setRequest(null)}
    />
  );
}
