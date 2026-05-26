"use client";

/**
 * Client wrapper around the `runDiscovery` server action.
 *
 * State surfacing moved out of inline JSX into the toast system
 * (components/admin-ui/ToastProvider) for a cleaner row layout.
 */

import { useActionState } from "react";

import { useActionToast } from "@/components/admin-ui/use-action-toast";

import {
  runDiscovery,
  type ActionResult,
  type RunDiscoveryResult,
} from "../actions";

interface Props {
  trackedLocationId: string;
  defaultLimit?: number;
}

const initial: ActionResult<RunDiscoveryResult> | null = null;

export function RunDiscoveryButton({
  trackedLocationId,
  defaultLimit = 100,
}: Props) {
  const [state, formAction, pending] = useActionState(runDiscovery, initial);
  useActionToast(state);
  return (
    <form action={formAction} style={{ display: "inline-flex", gap: 6 }}>
      <input type="hidden" name="trackedLocationId" value={trackedLocationId} />
      <select
        name="limit"
        defaultValue={defaultLimit}
        className="admin-select"
        style={{ padding: "6px 8px", fontSize: 11 }}
        disabled={pending}
        aria-label="Discovery result limit"
      >
        <option value={25}>25</option>
        <option value={50}>50</option>
        <option value={100}>100</option>
        <option value={200}>200</option>
      </select>
      <button
        type="submit"
        className="admin-btn"
        data-variant="primary"
        disabled={pending}
        style={{ padding: "6px 12px", fontSize: 11 }}
      >
        {pending ? "Running…" : "Run"}
      </button>
    </form>
  );
}
