/**
 * Hunter filter evaluation · types · D.4
 *
 * The Hunter is Mapsly's moat: 60+ signals across 8 categories, expressed
 * as a stored {@link FilterSpec} that the agency tunes. This module is the
 * in-memory evaluator that decides which businesses match a given spec.
 *
 * Wire format: a list's `filterJson` column on Prisma's `List` model is a
 * serialized {@link FilterSpec}. The cron-side refresh handler hydrates the
 * relevant business rows, then runs this evaluator.
 *
 * See `.claude/rules/signal-engineering.md` for the canonical contract and
 * D.4 in PLAN.md for the task description.
 */

import type {
  Comparator,
  FilterRow,
  FilterValue,
} from "@/modules/signals/types";

/**
 * A list's complete filter expression. Stored on `List.filterJson` and
 * passed to the evaluator on every refresh.
 *
 * - `rows`: ordinary filter conditions. Composed via {@link FilterSpec.combine}.
 * - `combine`: how to combine `rows`. Default is `"and"` (all must match);
 *   `"or"` means any one is enough.
 * - `exclusions`: filter rows that, when matched, REMOVE the business from
 *   the list (independent of `combine`). Use for "skip already contacted"
 *   or "skip closed businesses" semantics. A business is excluded if ANY
 *   exclusion row matches.
 *
 * Exclusions live in their own array (not merged with rows) so:
 *   1. The Hunter UI can render them in their own group.
 *   2. We can short-circuit evaluation: an exclusion match terminates the row.
 *   3. The semantics survive when `combine === "or"` (exclusions still AND-out).
 *
 * Both arrays default to empty when missing on the wire — be lenient when
 * reading user-stored JSON.
 */
export interface FilterSpec {
  readonly rows?: readonly FilterRow[];
  readonly combine?: "and" | "or";
  readonly exclusions?: readonly FilterRow[];
}

/**
 * A normalized, in-memory shape representing one business + its latest
 * related rows. The evaluator reads from here — never from Prisma directly.
 *
 * The cron-side hydrator builds these rows with one query per relation
 * (selecting only the columns referenced by the spec). Multi-row relations
 * (`reviews`, `serpResults`, `adLibraryEntries`) are passed as arrays;
 * the evaluator's aggregation rule is "any matches" (see {@link evaluate}).
 *
 * Fields are weakly typed (Record<string, unknown>) on purpose — every
 * signal's `column` reference is resolved against this shape via
 * {@link resolveColumnValue}, which doesn't need compile-time knowledge of
 * the schema. Strong typing would couple this evaluator to Prisma's
 * generated types, which would re-pin every schema migration.
 */
export interface EvaluationRow {
  readonly id: string;
  readonly business: Record<string, unknown>;
  readonly snapshot?: Record<string, unknown> | null;
  readonly lighthouseAudit?: Record<string, unknown> | null;
  readonly reviews?: readonly Record<string, unknown>[];
  readonly serpResults?: readonly Record<string, unknown>[];
  readonly adLibraryEntries?: readonly Record<string, unknown>[];
}

/**
 * The result of evaluating one business against a spec. Boolean is enough
 * for the production path; a detailed shape is exposed for the Hunter UI's
 * "Why this business qualifies" panel.
 */
export interface RowVerdict {
  readonly matches: boolean;
  /** Per-row pass/fail — useful for debugging + the UI's "why" panel. */
  readonly trace?: readonly RowVerdictTrace[];
}

export interface RowVerdictTrace {
  readonly signalKey: string;
  readonly comparator: Comparator;
  readonly expected: FilterValue;
  readonly actual: unknown;
  readonly matched: boolean;
  readonly isExclusion: boolean;
}

/**
 * The set delta between two refresh passes. The cron handler uses this to
 * write `Lead` rows for `added`, mark `removed` rows as `HIDDEN`, and skip
 * unchanged rows in subsequent revalidation work.
 */
export interface RefreshDelta {
  /** Business IDs newly matching the list. */
  readonly added: readonly string[];
  /** Business IDs that previously matched but no longer do. */
  readonly removed: readonly string[];
  /** Business IDs still matching (no change). */
  readonly stable: readonly string[];
}

/**
 * Tables (Prisma model names) referenced by a filter spec, derived from
 * the signal registry's `column` field. Used by the incremental layer to
 * decide which relations to re-fetch.
 *
 * Stable values are `"Business" | "BusinessSnapshot" | "LighthouseAudit"
 * | "Review" | "SerpResult" | "AdLibraryEntry"`. We type as `string` (not
 * a closed union) so future signal additions don't require a code change
 * here.
 */
export type ModelName = string;
