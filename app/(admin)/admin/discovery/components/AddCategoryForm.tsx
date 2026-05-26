"use client";

/**
 * "Add category" form · admin picks from the curated list.
 *
 * The list of selectable categories is built server-side and passed
 * as a plain string-array prop (per Pattern 4b — no functions across
 * the boundary). Already-registered IDs are excluded by the caller.
 */

import { useActionState } from "react";

import { useActionToast } from "@/components/admin-ui/use-action-toast";

import { addCategory, type ActionResult } from "../actions";

interface PickableCategory {
  dataforseoId: string;
  label: string;
  groupKey: string;
  phase: number;
  score: number;
}

interface Props {
  available: PickableCategory[];
}

const initial: ActionResult<{ categoryId: string }> | null = null;

export function AddCategoryForm({ available }: Props) {
  const [state, formAction, pending] = useActionState(addCategory, initial);
  useActionToast(state);

  if (available.length === 0) {
    return (
      <p className="admin-muted" style={{ fontSize: 12 }}>
        All curated categories from the launch plan are already in the registry.
        Add more verticals to{" "}
        <code className="admin-mono">
          modules/business-discovery/known-categories.ts
        </code>{" "}
        and ship a change to expand.
      </p>
    );
  }

  // Sort by phase, then score (highest first)
  const sorted = [...available].sort((a, b) => {
    if (a.phase !== b.phase) return a.phase - b.phase;
    return b.score - a.score;
  });

  return (
    <form action={formAction} className="admin-form">
      <div className="admin-field">
        <label htmlFor="category-picker" className="admin-label">
          Category
        </label>
        <select
          id="category-picker"
          name="dataforseoId"
          className="admin-select"
          defaultValue={sorted[0]?.dataforseoId ?? ""}
          required
        >
          {sorted.map((c) => (
            <option key={c.dataforseoId} value={c.dataforseoId}>
              Phase {c.phase} · {c.label} ({c.score}/100)
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="submit"
          className="admin-btn"
          data-variant="primary"
          disabled={pending}
        >
          {pending ? "Adding…" : "Add category"}
        </button>
      </div>
    </form>
  );
}
