"use client";

/**
 * Delete a TrackedLocation · only rendered for cells with
 * `businessCount === 0`. The page enforces visibility; the server
 * action re-checks before deleting.
 *
 * Confirmation uses our custom ConfirmDialog (not window.confirm) to
 * keep the visual treatment consistent with the rest of /admin.
 */

import { useActionState, useRef, type FormEvent } from "react";

import { useConfirm } from "@/components/admin-ui/ConfirmProvider";
import { useActionToast } from "@/components/admin-ui/use-action-toast";

import { deleteLocation, type ActionResult } from "../actions";

interface Props {
  trackedLocationId: string;
  city: string;
  /**
   * When true, the cell still has indexed businesses and can't be
   * deleted — render the button greyed out (with explanatory tooltip)
   * so the row keeps the same column shape as empty cells. Removing
   * the button entirely caused the action column to shift width.
   */
  disabled?: boolean;
}

const initial: ActionResult | null = null;

export function DeleteLocationButton({
  trackedLocationId,
  city,
  disabled = false,
}: Props) {
  const confirm = useConfirm();
  const [state, formAction, pending] = useActionState(deleteLocation, initial);
  useActionToast(state);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await confirm({
      title: `Remove "${city}"?`,
      body: "This deletes the cell and its run history. The category and other locations are unaffected.",
      confirmText: "Delete",
      danger: true,
    });
    if (!ok) return;
    formRef.current?.requestSubmit();
    // requestSubmit() bypasses the custom onSubmit because the second
    // call comes from outside the synthetic event flow · the form
    // hits formAction directly without re-entering this handler.
  }

  const isDisabled = pending || disabled;
  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={handleSubmit}
      style={{ display: "inline-flex" }}
    >
      <input type="hidden" name="trackedLocationId" value={trackedLocationId} />
      <button
        type="submit"
        className="admin-btn"
        data-variant="ghost"
        disabled={isDisabled}
        title={
          disabled
            ? "Cell has indexed businesses — delete them or wait before removing."
            : "Delete this empty cell"
        }
        style={{
          padding: "6px 10px",
          fontSize: 11,
          color: "var(--admin-err)",
          borderColor: "rgba(248,113,113,.35)",
        }}
      >
        {pending ? "…" : "Delete"}
      </button>
    </form>
  );
}
