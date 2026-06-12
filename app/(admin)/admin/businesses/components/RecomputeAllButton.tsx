"use client";

/**
 * Client wrapper around `recomputeAllFromExistingDataAction`. Runs the FULL
 * scoring pipeline from existing data — NO DataForSEO: rebuilds every qualified
 * business's signalsJson → cell medians → pillar scores + MSI. Use to roll out
 * a scoring-formula change across the whole index at once. Heavier than
 * "Recompute scores" (it rebuilds snapshots first); surfaces the summary via
 * the toast system.
 */

import { useActionState } from "react";

import { useActionToast } from "@/components/admin-ui/use-action-toast";

import {
  recomputeAllFromExistingDataAction,
  type ActionResult,
  type RecomputeAllActionResult,
} from "../actions";

const initial: ActionResult<RecomputeAllActionResult> | null = null;

export function RecomputeAllButton() {
  const [state, formAction, pending] = useActionState(
    recomputeAllFromExistingDataAction,
    initial,
  );
  useActionToast(state);
  return (
    <form action={formAction}>
      <button
        type="submit"
        className="admin-btn"
        data-variant="ghost"
        disabled={pending}
        title="Rebuild signalsJson (existing data · no DfS) → cell medians → pillar scores. Use after a scoring-formula change."
        style={{ whiteSpace: "nowrap" }}
      >
        {pending ? "Recomputing all…" : "Recompute all (no DfS)"}
      </button>
    </form>
  );
}
