"use client";

/**
 * Per-row action buttons for /admin/businesses.
 * - "Pull reviews" · triggers a manual review-pull (DataForSEO Standard).
 * - "Re-qualify"   · re-runs qualifyBusiness for this row.
 *
 * Both use the project's existing useActionState + useActionToast wiring
 * so success / failure surfaces in a toast without inline UI churn.
 */

import { useActionState } from "react";

import { useActionToast } from "@/components/admin-ui/use-action-toast";

import {
  triggerReviewPullAction,
  rerunQualifyAction,
  type ActionResult,
  type TriggerReviewPullActionResult,
  type RerunQualifyActionResult,
} from "../actions";

interface Props {
  businessId: string;
  hasInFlight: boolean;
  hasCid: boolean;
}

const initialPull: ActionResult<TriggerReviewPullActionResult> | null = null;
const initialQualify: ActionResult<RerunQualifyActionResult> | null = null;

export function RowActionButtons({ businessId, hasInFlight, hasCid }: Props) {
  const [pullState, pullAction, pullPending] = useActionState(
    triggerReviewPullAction,
    initialPull,
  );
  const [qualifyState, qualifyAction, qualifyPending] = useActionState(
    rerunQualifyAction,
    initialQualify,
  );

  useActionToast(pullState);
  useActionToast(qualifyState);

  return (
    <div style={{ display: "inline-flex", gap: 4 }}>
      <form action={pullAction}>
        <input type="hidden" name="businessId" value={businessId} />
        <button
          type="submit"
          className="admin-btn"
          data-variant="ghost"
          disabled={pullPending || hasInFlight || !hasCid}
          title={
            !hasCid
              ? "No Google CID · can't query DataForSEO"
              : hasInFlight
                ? "Review pull already in flight"
                : "Trigger a manual review pull"
          }
          style={{ padding: "4px 8px", fontSize: 10 }}
        >
          {pullPending ? "…" : hasInFlight ? "Pulling…" : "Pull reviews"}
        </button>
      </form>
      <form action={qualifyAction}>
        <input type="hidden" name="businessId" value={businessId} />
        <button
          type="submit"
          className="admin-btn"
          data-variant="ghost"
          disabled={qualifyPending}
          title="Re-run qualifyBusiness — overwrites status, flags, email."
          style={{ padding: "4px 8px", fontSize: 10 }}
        >
          {qualifyPending ? "…" : "Re-qualify"}
        </button>
      </form>
    </div>
  );
}
