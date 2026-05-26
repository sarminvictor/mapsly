"use client";

/**
 * Toggle wrapper · hides the "Add location" form until the admin
 * clicks the inline "+ Add location" button. Keeps the page calm
 * (one form expanded at a time) while still being keyboard-accessible
 * (the button is focusable + collapses the form when re-pressed).
 */

import { useState } from "react";

import { AddLocationForm } from "./AddLocationForm";

interface Props {
  categoryId: string;
  categoryLabel: string;
}

export function AddLocationToggle({ categoryId, categoryLabel }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        className="admin-btn"
        data-variant="ghost"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ marginBottom: open ? 10 : 0 }}
      >
        {open ? "× Cancel" : "+ Add location"}
      </button>
      {open ? (
        <AddLocationForm
          categoryId={categoryId}
          categoryLabel={categoryLabel}
        />
      ) : null}
    </div>
  );
}
