"use client";

// FreshnessChip · the 6-month cell freshness indicator (Phase 9). One chip
// carries the whole freshness + $0-to-serve story.

import { freshnessChip, toneClasses } from "../visual-helpers";
import type { FreshnessState } from "@/lib/cell";

export function FreshnessChip({ state }: { state: FreshnessState }) {
  const c = freshnessChip(state);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${toneClasses(c.tone)}`}
      title={c.dollars}
    >
      <span aria-hidden>●</span>
      {c.label} · {c.dollars}
    </span>
  );
}
