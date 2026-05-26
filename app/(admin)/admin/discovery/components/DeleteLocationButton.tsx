"use client";

/**
 * Delete a TrackedLocation · only rendered for cells with
 * `businessCount === 0` (the page enforces visibility; the server
 * action re-checks before deleting). One-step confirm via the
 * browser's native confirm dialog — admin tooling, no need for a
 * custom modal.
 */

import { useActionState } from "react";

import { deleteLocation, type ActionResult } from "../actions";

interface Props {
  trackedLocationId: string;
  city: string;
}

const initial: ActionResult | null = null;

export function DeleteLocationButton({ trackedLocationId, city }: Props) {
  const [state, formAction, pending] = useActionState(deleteLocation, initial);
  return (
    <form
      action={formAction}
      style={{ display: "inline-flex" }}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Remove "${city}" from the registry? This deletes the cell and its run history.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="trackedLocationId" value={trackedLocationId} />
      <button
        type="submit"
        className="admin-btn"
        data-variant="ghost"
        disabled={pending}
        title="Delete this empty cell"
        style={{
          padding: "6px 10px",
          fontSize: 11,
          color: "var(--admin-err)",
          borderColor: "rgba(248,113,113,.35)",
        }}
      >
        {pending ? "…" : "Delete"}
      </button>
      {state && !state.ok ? (
        <span
          role="alert"
          style={{
            fontSize: 11,
            color: "var(--admin-err)",
            alignSelf: "center",
            marginLeft: 6,
          }}
        >
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
