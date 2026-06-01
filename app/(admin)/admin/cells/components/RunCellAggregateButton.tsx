"use client";

/**
 * Client wrapper around the `runCellAggregationAction` server action. Rebuilds
 * every CellMetric market reference; surfaces the summary via the toast system.
 */

import { useActionState } from "react";

import { useActionToast } from "@/components/admin-ui/use-action-toast";

import { runCellAggregationAction, type ActionResult } from "../actions";
import type { CellAggregationSummary } from "@/modules/market/cell-metrics";

const initial: ActionResult<CellAggregationSummary> | null = null;

export function RunCellAggregateButton() {
  const [state, formAction, pending] = useActionState(
    runCellAggregationAction,
    initial,
  );
  useActionToast(state);
  return (
    <form action={formAction}>
      <button
        type="submit"
        className="admin-btn"
        data-variant="primary"
        disabled={pending}
        style={{ whiteSpace: "nowrap" }}
      >
        {pending ? "Recomputing…" : "Recompute references"}
      </button>
    </form>
  );
}
