"use client";

import { useActionState } from "react";

import { useActionToast } from "@/components/admin-ui/use-action-toast";

import { toggleLocationActive, type ActionResult } from "../actions";

interface Props {
  trackedLocationId: string;
  isActive: boolean;
}

const initial: ActionResult | null = null;

export function ToggleLocationButton({ trackedLocationId, isActive }: Props) {
  const [state, formAction, pending] = useActionState(
    toggleLocationActive,
    initial,
  );
  useActionToast(state, {
    successTitle: isActive ? "Cell paused" : "Cell resumed",
  });
  const nextState = !isActive;
  return (
    <form action={formAction} style={{ display: "inline-flex" }}>
      <input type="hidden" name="trackedLocationId" value={trackedLocationId} />
      <input type="hidden" name="isActive" value={String(nextState)} />
      <button
        type="submit"
        className="admin-btn"
        data-variant="ghost"
        disabled={pending}
        title={isActive ? "Pause this cell" : "Resume this cell"}
        style={{ padding: "6px 10px", fontSize: 11 }}
      >
        {pending ? "…" : isActive ? "Pause" : "Resume"}
      </button>
    </form>
  );
}
