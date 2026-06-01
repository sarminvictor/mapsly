"use client";

/**
 * Client wrapper around the `recomputeScoresAction` server action. Recomputes
 * the 5 market-relative pillars + MSI for the index and writes them onto the
 * latest snapshots; surfaces the summary via the toast system. Run "Recompute
 * references" on /admin/cells first so scores grade against fresh medians.
 */

import { useActionState } from "react";

import { useActionToast } from "@/components/admin-ui/use-action-toast";

import { recomputeScoresAction, type ActionResult } from "../actions";
import type { PillarScoringSummary } from "@/modules/market/pillar-scoring";

const initial: ActionResult<PillarScoringSummary> | null = null;

export function RecomputeScoresButton() {
  const [state, formAction, pending] = useActionState(
    recomputeScoresAction,
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
        {pending ? "Recomputing…" : "Recompute scores"}
      </button>
    </form>
  );
}
