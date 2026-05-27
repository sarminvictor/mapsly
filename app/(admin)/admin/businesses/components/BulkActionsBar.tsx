"use client";

/**
 * Sticky bulk-action bar for /admin/businesses.
 * Selects via checkboxes in the row table; this component reads the
 * selected ids from a sibling hook + form-posts them to the bulk action.
 *
 * For v1 simplicity, selection state lives in a parent `useState` and
 * is passed down. The selected ids are POSTed as a single comma-
 * separated string to satisfy FormData's flat shape.
 */

import { useActionState } from "react";

import { useActionToast } from "@/components/admin-ui/use-action-toast";

import {
  triggerReviewPullBulkAction,
  type ActionResult,
  type BulkReviewPullActionResult,
} from "../actions";

interface Props {
  selectedIds: string[];
  onClear: () => void;
}

const initial: ActionResult<BulkReviewPullActionResult> | null = null;

export function BulkActionsBar({ selectedIds, onClear }: Props) {
  const [state, formAction, pending] = useActionState(
    triggerReviewPullBulkAction,
    initial,
  );
  useActionToast(state);

  if (selectedIds.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      style={{
        position: "sticky",
        bottom: 16,
        zIndex: 10,
        background: "var(--admin-bg-2)",
        border: "1px solid var(--admin-border)",
        borderRadius: 12,
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--admin-text)",
          fontWeight: 600,
        }}
      >
        {selectedIds.length} selected
      </span>

      <form
        action={formAction}
        style={{ display: "inline-flex", marginLeft: "auto" }}
      >
        <input type="hidden" name="businessIds" value={selectedIds.join(",")} />
        <button
          type="submit"
          className="admin-btn"
          data-variant="primary"
          disabled={pending}
          style={{ padding: "6px 12px", fontSize: 11 }}
          title="Enqueues the pull on Boxly Worker · returns in seconds · pingbacks land 1–45 min later"
        >
          {pending ? "Queueing…" : `Pull reviews for ${selectedIds.length}`}
        </button>
      </form>

      <button
        type="button"
        className="admin-btn"
        data-variant="ghost"
        onClick={onClear}
        style={{ padding: "6px 12px", fontSize: 11 }}
      >
        Clear
      </button>
    </div>
  );
}
