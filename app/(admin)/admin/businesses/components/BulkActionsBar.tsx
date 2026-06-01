"use client";

/**
 * Sticky bulk-action bar for /admin/businesses.
 * Selects via checkboxes in the row table; this component reads the
 * selected ids from a sibling hook + form-posts them to the bulk action.
 *
 * For v1 simplicity, selection state lives in a parent `useState` and
 * is passed down. The selected ids are POSTed as a single comma-
 * separated string to satisfy FormData's flat shape.
 */

import { useActionState } from "react";

import { useActionToast } from "@/components/admin-ui/use-action-toast";

import {
  triggerReviewPullBulkAction,
  triggerSearchScanBulkAction,
  triggerAdsScanBulkAction,
  triggerWebsiteScanBulkAction,
  type ActionResult,
  type BulkReviewPullActionResult,
  type SearchScanActionResult,
  type AdsScanActionResult,
  type WebsiteScanActionResult,
} from "../actions";

interface Props {
  selectedIds: string[];
  onClear: () => void;
}

const initialReviews: ActionResult<BulkReviewPullActionResult> | null = null;
const initialSearch: ActionResult<SearchScanActionResult> | null = null;
const initialAds: ActionResult<AdsScanActionResult> | null = null;
const initialWebsite: ActionResult<WebsiteScanActionResult> | null = null;

export function BulkActionsBar({ selectedIds, onClear }: Props) {
  const [reviewsState, reviewsAction, reviewsPending] = useActionState(
    triggerReviewPullBulkAction,
    initialReviews,
  );
  const [searchState, searchAction, searchPending] = useActionState(
    triggerSearchScanBulkAction,
    initialSearch,
  );
  const [adsState, adsAction, adsPending] = useActionState(
    triggerAdsScanBulkAction,
    initialAds,
  );
  const [websiteState, websiteAction, websitePending] = useActionState(
    triggerWebsiteScanBulkAction,
    initialWebsite,
  );
  useActionToast(reviewsState);
  useActionToast(searchState);
  useActionToast(adsState);
  useActionToast(websiteState);

  if (selectedIds.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      style={{
        position: "sticky",
        bottom: 16,
        zIndex: 10,
        background: "var(--admin-bg-2)",
        border: "1px solid var(--admin-border)",
        borderRadius: 12,
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--admin-text)",
          fontWeight: 600,
        }}
      >
        {selectedIds.length} selected
      </span>

      <div
        style={{
          display: "inline-flex",
          marginLeft: "auto",
          gap: 6,
          alignItems: "center",
        }}
      >
        <form action={reviewsAction} style={{ display: "inline-flex" }}>
          <input
            type="hidden"
            name="businessIds"
            value={selectedIds.join(",")}
          />
          <button
            type="submit"
            className="admin-btn"
            data-variant="primary"
            disabled={reviewsPending}
            style={{ padding: "6px 12px", fontSize: 11 }}
            title="Enqueues review pulls on Boxly Worker · returns in seconds · pingbacks land 1–45 min later"
          >
            {reviewsPending
              ? "Queueing…"
              : `Pull reviews for ${selectedIds.length}`}
          </button>
        </form>

        <form action={searchAction} style={{ display: "inline-flex" }}>
          <input
            type="hidden"
            name="businessIds"
            value={selectedIds.join(",")}
          />
          <button
            type="submit"
            className="admin-btn"
            data-variant="primary"
            disabled={searchPending}
            style={{ padding: "6px 12px", fontSize: 11 }}
            title="Per-biz ranked_keywords + ONE Maps aggregate per unique cell (no duplicate cell work). Paid-cell gated."
          >
            {searchPending
              ? "Queueing…"
              : `Run SERP scan for ${selectedIds.length}`}
          </button>
        </form>

        <form action={adsAction} style={{ display: "inline-flex" }}>
          <input
            type="hidden"
            name="businessIds"
            value={selectedIds.join(",")}
          />
          <button
            type="submit"
            className="admin-btn"
            data-variant="primary"
            disabled={adsPending}
            style={{ padding: "6px 12px", fontSize: 11 }}
            title="Keyword costs + Google Ads Transparency for the selected businesses + competitors (inline, capped at 8/run). Meta refreshes weekly."
          >
            {adsPending ? "Running…" : `Run Ads for ${selectedIds.length}`}
          </button>
        </form>

        <form action={websiteAction} style={{ display: "inline-flex" }}>
          <input
            type="hidden"
            name="businessIds"
            value={selectedIds.join(",")}
          />
          <button
            type="submit"
            className="admin-btn"
            data-variant="primary"
            disabled={websitePending}
            style={{ padding: "6px 12px", fontSize: 11 }}
            title="Lighthouse speed + Core Web Vitals + schema/NAP/booking checks for the selected businesses (inline, capped at 5/run · same as the weekly cron). Businesses without a website are skipped."
          >
            {websitePending
              ? "Running…"
              : `Run Website for ${selectedIds.length}`}
          </button>
        </form>
      </div>

      <button
        type="button"
        className="admin-btn"
        data-variant="ghost"
        onClick={onClear}
        style={{ padding: "6px 12px", fontSize: 11 }}
      >
        Clear
      </button>
    </div>
  );
}
