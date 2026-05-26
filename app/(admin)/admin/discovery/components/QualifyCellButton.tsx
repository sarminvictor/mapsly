"use client";

/**
 * Trigger qualification for every business in the cell. The action
 * returns IMMEDIATELY after enqueueing jobs to Boxly Worker — actual
 * scraping happens in the background (~1-2 min for 100 businesses at
 * worker concurrency=10). Result lands in a toast, not inline.
 */

import { useActionState } from "react";

import { useActionToast } from "@/components/admin-ui/use-action-toast";

import {
  runQualifyCell,
  type ActionResult,
  type QualifyCellResult,
} from "../actions";

interface Props {
  trackedLocationId: string;
  pendingCount: number;
}

const initial: ActionResult<QualifyCellResult> | null = null;

export function QualifyCellButton({ trackedLocationId, pendingCount }: Props) {
  const [state, formAction, pending] = useActionState(runQualifyCell, initial);
  useActionToast(state);
  return (
    <form action={formAction} style={{ display: "inline-flex" }}>
      <input type="hidden" name="trackedLocationId" value={trackedLocationId} />
      <button
        type="submit"
        className="admin-btn"
        data-variant="ghost"
        disabled={pending || pendingCount === 0}
        title={
          pendingCount === 0
            ? "No businesses indexed yet — run discovery first"
            : `Queue ${pendingCount} businesses for background qualification`
        }
        style={{ padding: "6px 10px", fontSize: 11 }}
      >
        {pending ? "Queueing…" : `Qualify (${pendingCount})`}
      </button>
    </form>
  );
}
