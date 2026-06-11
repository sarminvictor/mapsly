"use client";

/**
 * Trigger qualification for every PENDING business in the cell. The
 * action returns IMMEDIATELY after enqueueing jobs to Boxly Worker —
 * actual scraping happens in the background (~1-2 min for 100
 * businesses at worker concurrency=10). Result lands in a toast.
 *
 * After a successful enqueue the row's tallies move server-side as
 * worker callbacks land (recomputeCellAggregates per callback), so we
 * poll router.refresh() for a few minutes to show live progress —
 * before this, the page sat frozen on stale counts inviting a
 * duplicate click (2026-06-11 incident).
 */

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { useActionToast } from "@/components/admin-ui/use-action-toast";

import {
  runQualifyCell,
  type ActionResult,
  type QualifyCellResult,
} from "../actions";

const PROGRESS_POLL_MS = 10_000;
const PROGRESS_POLL_WINDOW_MS = 5 * 60_000;

interface Props {
  trackedLocationId: string;
  pendingCount: number;
}

const initial: ActionResult<QualifyCellResult> | null = null;

export function QualifyCellButton({ trackedLocationId, pendingCount }: Props) {
  const [state, formAction, pending] = useActionState(runQualifyCell, initial);
  useActionToast(state);
  const router = useRouter();
  const pollUntil = useRef<number | null>(null);

  useEffect(() => {
    if (!state?.ok || state.data.queued === 0) return;
    pollUntil.current = Date.now() + PROGRESS_POLL_WINDOW_MS;
    const interval = setInterval(() => {
      if (pollUntil.current === null || Date.now() > pollUntil.current) {
        clearInterval(interval);
        return;
      }
      router.refresh();
    }, PROGRESS_POLL_MS);
    return () => clearInterval(interval);
  }, [state, router]);

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
            ? "Nothing pending — every indexed business is already qualified"
            : `Queue ${pendingCount} pending businesses for background qualification`
        }
        style={{ padding: "6px 10px", fontSize: 11 }}
      >
        {pending ? "Queueing…" : `Qualify (${pendingCount})`}
      </button>
    </form>
  );
}
