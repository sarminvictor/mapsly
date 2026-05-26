"use client";

/**
 * Delete a BusinessCategory · only rendered when the group has zero
 * TrackedLocation rows (the page enforces visibility; the server
 * action re-checks). Categories with any locations get the Add
 * Location CTA only — admin must clear children first.
 */

import { useActionState } from "react";

import { deleteCategory, type ActionResult } from "../actions";

interface Props {
  categoryId: string;
  label: string;
}

const initial: ActionResult | null = null;

export function DeleteCategoryButton({ categoryId, label }: Props) {
  const [state, formAction, pending] = useActionState(deleteCategory, initial);
  return (
    <form
      action={formAction}
      style={{ display: "inline-flex" }}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Remove "${label}" from the registry? It has no locations and no businesses indexed.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="categoryId" value={categoryId} />
      <button
        type="submit"
        className="admin-btn"
        data-variant="ghost"
        disabled={pending}
        title="Delete this empty category"
        style={{
          padding: "6px 10px",
          fontSize: 11,
          color: "var(--admin-err)",
          borderColor: "rgba(248,113,113,.35)",
        }}
      >
        {pending ? "Deleting…" : "Delete category"}
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
