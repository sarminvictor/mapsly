"use client";

// BulkGenerateTouchesButton (WP5-1) · the "Generate touches (N)" bulk-bar
// button + its overlay, self-contained so the LeadsWorkbench edit is a 1-line
// import + 1-line JSX insertion (the bulk-bar area is a shared surface — see
// the WP5 collision map).

import { useState } from "react";

import { GenerateTouchesOverlay } from "./GenerateTouchesOverlay";

export interface BulkGenerateTouchesButtonProps {
  /** businessIds of the SELECTED rows (the overlay drafts for exactly these). */
  businessIds: string[];
  discoveryId?: string;
}

export function BulkGenerateTouchesButton({
  businessIds,
  discoveryId,
}: BulkGenerateTouchesButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="bb"
        disabled={businessIds.length === 0}
        onClick={() => setOpen(true)}
      >
        Generate touches ({businessIds.length})
      </button>
      <GenerateTouchesOverlay
        businessIds={businessIds}
        discoveryId={discoveryId}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
