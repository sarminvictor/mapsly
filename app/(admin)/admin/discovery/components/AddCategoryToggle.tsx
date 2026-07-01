"use client";

/**
 * Toggle wrapper for the "Add category" form · mirrors AddLocationToggle.
 */

import { useState } from "react";

import { AddCategoryForm } from "./AddCategoryForm";

interface PickableCategory {
  dataforseoId: string;
  label: string;
  groupKey: string;
  phase?: number;
  score?: number;
}

interface Props {
  available: PickableCategory[];
}

export function AddCategoryToggle({ available }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        className="admin-btn"
        data-variant="primary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "× Cancel" : "+ Add category"}
      </button>
      {open ? (
        <div style={{ marginTop: 12 }}>
          <AddCategoryForm available={available} />
        </div>
      ) : null}
    </div>
  );
}
