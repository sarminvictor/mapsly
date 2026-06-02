"use client";

/**
 * Client form around `mintLandingAction` — generates (or fetches) the landing
 * page for a business id and surfaces the resulting `/l/...` path via toast +
 * an inline open link.
 */

import { useActionState } from "react";

import { useActionToast } from "@/components/admin-ui/use-action-toast";

import {
  mintLandingAction,
  type ActionResult,
  type MintActionResult,
} from "../actions";

const initial: ActionResult<MintActionResult> | null = null;

export function MintLandingForm() {
  const [state, formAction, pending] = useActionState(
    mintLandingAction,
    initial,
  );
  useActionToast(state);
  return (
    <form
      action={formAction}
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <input
        name="businessId"
        placeholder="Business id (from /admin/businesses)"
        required
        style={{
          flex: "1 1 340px",
          height: 38,
          padding: "0 12px",
          borderRadius: 8,
          border: "1px solid #d0d4e0",
          fontSize: 14,
        }}
      />
      <button
        type="submit"
        className="admin-btn"
        data-variant="primary"
        disabled={pending}
        style={{ whiteSpace: "nowrap" }}
      >
        {pending ? "Generating…" : "Generate landing"}
      </button>
      {state?.ok ? (
        <a
          href={state.data.path}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 13, color: "#5b3df5" }}
        >
          {state.data.path} ↗
        </a>
      ) : null}
    </form>
  );
}
