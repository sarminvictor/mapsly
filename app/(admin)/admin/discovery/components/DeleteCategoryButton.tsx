"use client";

/**
 * Delete a BusinessCategory · only rendered when the group has zero
 * TrackedLocation rows. Same confirm/toast pattern as DeleteLocationButton.
 */

import { useActionState, useRef, type FormEvent } from "react";

import { useConfirm } from "@/components/admin-ui/ConfirmProvider";
import { useActionToast } from "@/components/admin-ui/use-action-toast";

import { deleteCategory, type ActionResult } from "../actions";

interface Props {
  categoryId: string;
  label: string;
}

const initial: ActionResult | null = null;

export function DeleteCategoryButton({ categoryId, label }: Props) {
  const confirm = useConfirm();
  const [state, formAction, pending] = useActionState(deleteCategory, initial);
  useActionToast(state);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await confirm({
      title: `Remove "${label}"?`,
      body: "It has no locations and no businesses indexed. Removing it doesn't touch shared infrastructure — other categories stay.",
      confirmText: "Delete category",
      danger: true,
    });
    if (!ok) return;
    formRef.current?.requestSubmit();
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={handleSubmit}
      style={{ display: "inline-flex" }}
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
    </form>
  );
}
