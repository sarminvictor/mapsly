"use client";

/**
 * SMTP-verify + promote discovered emails for a cell's QUALIFIED
 * businesses — the bridge that makes them enrollable in cold
 * campaigns. One bounded batch (~60) per click; the count label is
 * how many QUALIFIED rows still have a discovered-but-unpromoted
 * email. Click until 0.
 */

import { useActionState } from "react";

import { useActionToast } from "@/components/admin-ui/use-action-toast";

import {
  runVerifyPromoteEmails,
  type ActionResult,
  type VerifyPromoteActionResult,
} from "../actions";

interface Props {
  trackedLocationId: string;
  /** QUALIFIED rows with emailDiscovered set and Business.email null. */
  promotableCount: number;
}

const initial: ActionResult<VerifyPromoteActionResult> | null = null;

export function VerifyEmailsButton({
  trackedLocationId,
  promotableCount,
}: Props) {
  const [state, formAction, pending] = useActionState(
    runVerifyPromoteEmails,
    initial,
  );
  useActionToast(state);
  return (
    <form action={formAction} style={{ display: "inline-flex" }}>
      <input type="hidden" name="trackedLocationId" value={trackedLocationId} />
      <button
        type="submit"
        className="admin-btn"
        data-variant="ghost"
        disabled={pending || promotableCount === 0}
        title={
          promotableCount === 0
            ? "No discovered emails waiting for verification"
            : `SMTP-verify ${promotableCount} discovered emails and promote the deliverable ones for outreach (batches of ~60 per click)`
        }
        style={{ padding: "6px 10px", fontSize: 11 }}
      >
        {pending ? "Verifying…" : `Verify emails (${promotableCount})`}
      </button>
    </form>
  );
}
