"use client";

/**
 * Revoke / re-activate a landing page. A revoked landing's link 404s; the
 * funnel history is preserved. Mirrors the admin action-button pattern.
 */

import { useActionState } from "react";

import { useActionToast } from "@/components/admin-ui/use-action-toast";

import { toggleLandingAction, type ActionResult } from "../actions";

const initial: ActionResult<{ active: boolean }> | null = null;

export function ToggleLandingButton({
  landingPageId,
  active,
}: {
  landingPageId: string;
  active: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    toggleLandingAction,
    initial,
  );
  useActionToast(state);
  return (
    <form action={formAction}>
      <input type="hidden" name="landingPageId" value={landingPageId} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <button
        type="submit"
        className="admin-btn"
        disabled={pending}
        style={{ whiteSpace: "nowrap" }}
      >
        {pending ? "…" : active ? "Revoke" : "Activate"}
      </button>
    </form>
  );
}
