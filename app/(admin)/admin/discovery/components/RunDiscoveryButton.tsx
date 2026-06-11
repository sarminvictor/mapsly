"use client";

/**
 * Client wrapper around the `runDiscovery` server action.
 *
 * State surfacing moved out of inline JSX into the toast system
 * (components/admin-ui/ToastProvider) for a cleaner row layout.
 *
 * Limit options go up to 5000 — the runner paginates DataForSEO in
 * ≤1000-row pages, so dense city cells can be pulled fully with
 * buffer. Labels show the worst-case cost (actual is lower when the
 * cell has fewer listings; DfS bills per returned row).
 */

import { useActionState } from "react";

import { useActionToast } from "@/components/admin-ui/use-action-toast";
import { estimateDiscoveryCostUsd } from "@/modules/business-discovery/pagination";

import {
  runDiscovery,
  type ActionResult,
  type RunDiscoveryResult,
} from "../actions";

interface Props {
  trackedLocationId: string;
  defaultLimit?: number;
}

const LIMIT_OPTIONS = [25, 50, 100, 200, 500, 1000, 2000, 5000, 10_000];

function optionLabel(n: number): string {
  const cost = estimateDiscoveryCostUsd(n);
  return `${n.toLocaleString()} · ~$${cost.toFixed(2)}`;
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
        title="Max listings to pull · paginated in 1000-row pages · cost shown is worst-case"
      >
        {LIMIT_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {optionLabel(n)}
          </option>
        ))}
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
