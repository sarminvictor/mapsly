"use client";

/**
 * Client wrapper around the `runDiscovery` server action.
 *
 * Per `.claude/rules/cache-components.md` Pattern 4b — we don't pass
 * the action function across the boundary; instead the form uses
 * `action={runDiscovery}` directly (Next.js server-action calling
 * convention). This file stays client-only because it owns the
 * `useActionState` + pending state.
 */

import { useActionState } from "react";

import {
  runDiscovery,
  type ActionResult,
  type RunDiscoveryResult,
} from "../actions";

interface Props {
  trackedLocationId: string;
  isActive: boolean;
  defaultLimit?: number;
}

const initial: ActionResult<RunDiscoveryResult> | null = null;

export function RunDiscoveryButton({
  trackedLocationId,
  isActive,
  defaultLimit = 100,
}: Props) {
  const [state, formAction, pending] = useActionState(runDiscovery, initial);
  return (
    <form action={formAction} style={{ display: "inline-flex", gap: 6 }}>
      <input type="hidden" name="trackedLocationId" value={trackedLocationId} />
      <select
        name="limit"
        defaultValue={defaultLimit}
        className="admin-select"
        style={{ padding: "6px 8px", fontSize: 11 }}
        disabled={pending || !isActive}
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
        disabled={pending || !isActive}
        style={{ padding: "6px 12px", fontSize: 11 }}
      >
        {pending ? "Running…" : "Run"}
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
