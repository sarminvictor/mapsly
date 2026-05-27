"use client";

/**
 * Per-row action buttons for /admin/businesses.
 * - "Pull reviews"     · triggers a manual review-pull (DfS Standard).
 * - "Run SERP scan"    · triggers ranked_keywords + cell-aggregate Maps.
 * - "Re-qualify"       · re-runs qualifyBusiness for this row.
 *
 * Each uses the project's existing useActionState + useActionToast wiring
 * so success / failure surfaces in a toast without inline UI churn.
 *
 * "Run SERP scan" is paid-cell gated · the dispatcher returns "0 eligible"
 * for businesses not in a paid cell and the toast says so. Admins can
 * still click; nothing destructive happens.
 */

import { useActionState } from "react";

import { useActionToast } from "@/components/admin-ui/use-action-toast";

import {
  triggerReviewPullAction,
  triggerSearchScanAction,
  rerunQualifyAction,
  type ActionResult,
  type TriggerReviewPullActionResult,
  type SearchScanActionResult,
  type RerunQualifyActionResult,
} from "../actions";

interface Props {
  businessId: string;
  hasInFlight: boolean;
  hasCid: boolean;
  hasWebsite: boolean;
}

const initialPull: ActionResult<TriggerReviewPullActionResult> | null = null;
const initialSearch: ActionResult<SearchScanActionResult> | null = null;
const initialQualify: ActionResult<RerunQualifyActionResult> | null = null;

export function RowActionButtons({
  businessId,
  hasInFlight,
  hasCid,
  hasWebsite,
}: Props) {
  const [pullState, pullAction, pullPending] = useActionState(
    triggerReviewPullAction,
    initialPull,
  );
  const [searchState, searchAction, searchPending] = useActionState(
    triggerSearchScanAction,
    initialSearch,
  );
  const [qualifyState, qualifyAction, qualifyPending] = useActionState(
    rerunQualifyAction,
    initialQualify,
  );

  useActionToast(pullState);
  useActionToast(searchState);
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
      <form action={searchAction}>
        <input type="hidden" name="businessId" value={businessId} />
        <button
          type="submit"
          className="admin-btn"
          data-variant="ghost"
          disabled={searchPending || !hasWebsite}
          title={
            !hasWebsite
              ? "No website · ranked_keywords requires a domain"
              : "Run SERP scan · ranked_keywords + cell-aggregate Maps"
          }
          style={{ padding: "4px 8px", fontSize: 10 }}
        >
          {searchPending ? "…" : "Run SERP scan"}
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
