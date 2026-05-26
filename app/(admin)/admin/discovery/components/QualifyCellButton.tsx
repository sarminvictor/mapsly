"use client";

/**
 * Trigger qualification for every business in the cell. The action
 * returns IMMEDIATELY after enqueueing jobs to Boxly Worker — actual
 * scraping happens in the background (~1-2 min for 100 businesses
 * at worker concurrency=10). Admin refreshes the page to see progress
 * tick up via the cell's qualified/disqualified/unreachable counts.
 */

import { useActionState } from "react";

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
  return (
    <form action={formAction} style={{ display: "inline-flex", gap: 6 }}>
      <input type="hidden" name="trackedLocationId" value={trackedLocationId} />
      <button
        type="submit"
        className="admin-btn"
        data-variant="ghost"
        disabled={pending || pendingCount === 0}
        title={
          pendingCount === 0
            ? "No businesses indexed yet — run discovery first"
            : `Queue ${pendingCount} businesses for background qualification (email scrape + RDAP + services)`
        }
        style={{ padding: "6px 10px", fontSize: 11 }}
      >
        {pending ? "Queueing…" : `Qualify (${pendingCount})`}
      </button>
      {state && !state.ok ? (
        <span
          role="alert"
          style={{
            fontSize: 11,
            color: "var(--admin-err)",
            alignSelf: "center",
            marginLeft: 6,
          }}
        >
          {state.error}
        </span>
      ) : null}
      {state && state.ok && state.message ? (
        <span
          style={{
            fontSize: 11,
            color: "var(--admin-ok)",
            alignSelf: "center",
            marginLeft: 6,
          }}
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
