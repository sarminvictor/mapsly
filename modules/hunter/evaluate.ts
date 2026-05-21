/**
 * Hunter filter evaluation · core · D.4
 *
 * Pure in-memory evaluator for the Hunter's filter spec.
 *
 * - One row in, one boolean out (`evaluateRow`).
 * - List of rows in, list of matching IDs out (`evaluateRows`).
 * - Detailed verdict for the "Why qualifies" UI panel (`evaluateRowWithTrace`).
 *
 * The evaluator stays out of the database. Hydration of `EvaluationRow`
 * happens in the cron handler / Hunter live-preview API layer.
 *
 * See `.claude/rules/signal-engineering.md` for the contract,
 * `modules/signals/comparators.ts` for single-comparator semantics, and
 * `modules/signals/registry.ts` for the column-to-Prisma-field map.
 */

import {
  evaluate as evaluateComparator,
  isValidComparator,
} from "@/modules/signals/comparators";
import { getSignal } from "@/modules/signals/registry";
import type {
  Comparator,
  FilterRow,
  FilterValue,
  SignalDefinition,
} from "@/modules/signals/types";

import type {
  EvaluationRow,
  FilterSpec,
  ModelName,
  RowVerdict,
  RowVerdictTrace,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Column resolution · `"Model.field"` → row value
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map from Prisma model name to the slot on {@link EvaluationRow} that
 * holds its data. Multi-row relations resolve to arrays; the comparator
 * layer then aggregates ("any row matches" semantics).
 *
 * Keep this map in sync with `EvaluationRow` and the `column:` values in
 * `modules/signals/registry.ts`.
 */
export const MODEL_TO_SLOT = {
  Business: "business",
  BusinessSnapshot: "snapshot",
  LighthouseAudit: "lighthouseAudit",
  Review: "reviews",
  SerpResult: "serpResults",
  AdLibraryEntry: "adLibraryEntries",
} as const satisfies Record<string, keyof EvaluationRow>;

/**
 * Models whose values are stored as arrays of rows in {@link EvaluationRow}.
 * The evaluator aggregates these with "any matches" semantics.
 */
const MULTI_ROW_SLOTS = new Set<keyof EvaluationRow>([
  "reviews",
  "serpResults",
  "adLibraryEntries",
]);

/** True if `s` is a recognized Model name. */
export function isKnownModel(s: string): s is keyof typeof MODEL_TO_SLOT {
  return Object.prototype.hasOwnProperty.call(MODEL_TO_SLOT, s);
}

/**
 * Parse `"Model.field"` into `[modelName, fieldPath]`. Supports nested
 * field paths (`"BusinessSnapshot.raw.someKey"`); the field portion may
 * contain dots for JSON traversal.
 *
 * Returns null if the column reference is malformed.
 */
export function parseColumnRef(
  column: string,
): { model: ModelName; field: string } | null {
  if (typeof column !== "string" || column.length === 0) return null;
  const dot = column.indexOf(".");
  if (dot <= 0 || dot >= column.length - 1) return null;
  const model = column.slice(0, dot);
  const field = column.slice(dot + 1);
  return { model, field };
}

/**
 * Resolve a `"Model.field"` reference against an {@link EvaluationRow}.
 *
 * - For single-row relations (Business / BusinessSnapshot / LighthouseAudit),
 *   returns the raw field value (may be `undefined` if the slot is null).
 * - For multi-row relations (Review / SerpResult / AdLibraryEntry), returns
 *   an array of field values, one per row. The comparator layer aggregates.
 * - For unknown models or malformed refs, returns `undefined` — the
 *   evaluator treats absent values per the comparator's `missing` rules.
 *
 * Nested JSON paths after the first dot are supported via plain index:
 *   `"BusinessSnapshot.raw.attribution"` → `row.snapshot?.raw?.attribution`.
 */
export function resolveColumnValue(
  row: EvaluationRow,
  column: string,
): unknown {
  const ref = parseColumnRef(column);
  if (!ref) return undefined;
  if (!isKnownModel(ref.model)) return undefined;

  const slot = MODEL_TO_SLOT[ref.model];
  const slotValue = row[slot];

  if (MULTI_ROW_SLOTS.has(slot)) {
    if (!Array.isArray(slotValue)) return [];
    return slotValue.map((r) =>
      r && typeof r === "object" ? deepGet(r, ref.field) : undefined,
    );
  }

  if (slotValue === null || slotValue === undefined) return undefined;
  if (typeof slotValue !== "object") return undefined;
  return deepGet(slotValue as Record<string, unknown>, ref.field);
}

/** Walk `obj.a.b.c` given path `"a.b.c"`. Returns `undefined` on miss. */
function deepGet(obj: Record<string, unknown>, path: string): unknown {
  if (path.indexOf(".") < 0) return obj[path];
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row + spec evaluation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate one filter row against the data extracted for one business.
 *
 * Aggregation rules:
 *   - Single-row relations: standard `evaluate()` against the field value.
 *   - Multi-row relations: returns true if ANY child row matches the
 *     comparator. Special case: `missing` matches when the relation is empty;
 *     `present` matches when at least one row exists.
 *
 * Unknown signals or invalid comparators return `false`. This is deliberate —
 * a list with a stale filter (signal removed in a later release) should
 * silently match nothing rather than throw at refresh time.
 */
export function evaluateRow(row: EvaluationRow, filter: FilterRow): boolean {
  const signal = getSignal(filter.signalKey);
  if (!signal) return false;
  if (!isValidComparator(signal.type, filter.comparator)) return false;

  return evaluateFilterAgainstSignal(row, signal, filter.comparator, filter.value);
}

function evaluateFilterAgainstSignal(
  row: EvaluationRow,
  signal: SignalDefinition,
  comparator: Comparator,
  expected: FilterValue,
): boolean {
  const ref = parseColumnRef(signal.column);
  if (!ref) return false;
  if (!isKnownModel(ref.model)) return false;

  const slot = MODEL_TO_SLOT[ref.model];

  // Multi-row relations: aggregate "any matches" + presence semantics.
  if (MULTI_ROW_SLOTS.has(slot)) {
    const arr = row[slot];
    const rows = Array.isArray(arr) ? arr : [];

    if (comparator === "missing") return rows.length === 0;
    if (comparator === "present") return rows.length > 0;

    if (rows.length === 0) return false;
    return rows.some((r) => {
      const value =
        r && typeof r === "object" ? deepGet(r, ref.field) : undefined;
      return evaluateComparator(signal.type, comparator, expected, value);
    });
  }

  // Single-row relation: pull the value, then defer to the comparator.
  const actual = resolveColumnValue(row, signal.column);
  return evaluateComparator(signal.type, comparator, expected, actual);
}

/**
 * Decide whether a single business satisfies the full spec.
 *
 * Semantics:
 *   1. Exclusions: if ANY exclusion row matches, the business is excluded
 *      regardless of `rows`. Short-circuits before `rows` evaluation.
 *   2. Empty `rows`: matches everything (caller is filtering only via
 *      exclusions and/or geo, which lives upstream of this evaluator).
 *   3. `combine === "and"` (default): all rows must match.
 *   4. `combine === "or"`: at least one row must match.
 */
export function evaluateSpec(row: EvaluationRow, spec: FilterSpec): boolean {
  const exclusions = spec.exclusions ?? [];
  for (const ex of exclusions) {
    if (evaluateRow(row, ex)) return false;
  }

  const rows = spec.rows ?? [];
  if (rows.length === 0) return true;

  const combine = spec.combine ?? "and";
  if (combine === "or") {
    return rows.some((r) => evaluateRow(row, r));
  }
  // and (default)
  return rows.every((r) => evaluateRow(row, r));
}

/**
 * Evaluate the spec + return a per-row trace. The Hunter UI's
 * "Why this business qualifies" panel reads this trace to label
 * each filter row's actual value alongside the expected threshold.
 *
 * Independent code path from {@link evaluateSpec} so the production
 * refresh handler never pays trace's allocation cost.
 */
export function evaluateSpecWithTrace(
  row: EvaluationRow,
  spec: FilterSpec,
): RowVerdict {
  const trace: RowVerdictTrace[] = [];
  const exclusions = spec.exclusions ?? [];
  const rows = spec.rows ?? [];
  let excluded = false;

  for (const ex of exclusions) {
    const matched = evaluateRow(row, ex);
    trace.push({
      signalKey: ex.signalKey,
      comparator: ex.comparator,
      expected: ex.value,
      actual: resolveActualForTrace(row, ex.signalKey),
      matched,
      isExclusion: true,
    });
    if (matched) excluded = true;
  }

  // Evaluate once · reuse the per-row matched values in the final combine
  // pass below so the trace path doesn't double-evaluate every filter row.
  const rowMatches: boolean[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row_ = rows[i];
    const matched = evaluateRow(row, row_);
    rowMatches[i] = matched;
    trace.push({
      signalKey: row_.signalKey,
      comparator: row_.comparator,
      expected: row_.value,
      actual: resolveActualForTrace(row, row_.signalKey),
      matched,
      isExclusion: false,
    });
  }

  let matches: boolean;
  if (excluded) {
    matches = false;
  } else if (rows.length === 0) {
    matches = true;
  } else {
    const combine = spec.combine ?? "and";
    matches =
      combine === "or"
        ? rowMatches.some((m) => m)
        : rowMatches.every((m) => m);
  }

  return { matches, trace };
}

/**
 * Best-effort actual-value extraction for trace display. Returns the raw
 * field value (single-row relation) or the array of values (multi-row
 * relation). Returns undefined for unknown signals — UI should render
 * "—" in that case.
 */
function resolveActualForTrace(row: EvaluationRow, signalKey: string): unknown {
  const signal = getSignal(signalKey);
  if (!signal) return undefined;
  return resolveColumnValue(row, signal.column);
}

/**
 * Apply the spec to a batch of rows. Returns the IDs of matching rows in
 * input order. Stable: same input → same output (no Set iteration order
 * surprises).
 */
export function evaluateRows(
  rows: readonly EvaluationRow[],
  spec: FilterSpec,
): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (evaluateSpec(row, spec)) out.push(row.id);
  }
  return out;
}

/**
 * Apply the spec, returning the full per-row trace. Use sparingly: the
 * trace allocation cost is non-trivial. Reserved for the Hunter UI's
 * preview pane and the prospect detail page.
 */
export function evaluateRowsWithTrace(
  rows: readonly EvaluationRow[],
  spec: FilterSpec,
): { id: string; verdict: RowVerdict }[] {
  return rows.map((row) => ({
    id: row.id,
    verdict: evaluateSpecWithTrace(row, spec),
  }));
}
