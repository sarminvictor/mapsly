/**
 * Comparator evaluation · D.1
 *
 * Pure functions that decide whether a given value matches a filter.
 * The Hunter query layer translates these to SQL via the `column` field
 * on the SignalDefinition; this module is the in-memory fallback used for:
 *   - Live preview (small batches)
 *   - Snapshot filtering in the dashboard
 *   - Unit tests covering the comparator semantics
 *
 * See `.claude/rules/signal-engineering.md` for the comparator catalog.
 */

import type {
  BooleanComparator,
  Comparator,
  DateComparator,
  EnumComparator,
  FilterValue,
  NumericComparator,
  SignalValueType,
  StringComparator,
} from "./types";

/**
 * Per-value-type comparator catalog. Exported so the Hunter UI can render
 * only valid options per signal.
 */
export const NUMERIC_COMPARATORS = [
  "<",
  "<=",
  "=",
  ">=",
  ">",
  "between",
  "missing",
  "present",
] as const satisfies readonly NumericComparator[];

export const BOOLEAN_COMPARATORS = [
  "is",
  "is_not",
] as const satisfies readonly BooleanComparator[];

export const ENUM_COMPARATORS = [
  "is",
  "is_not",
  "is_one_of",
  "is_none_of",
  "missing",
  "present",
] as const satisfies readonly EnumComparator[];

export const STRING_COMPARATORS = [
  "contains",
  "not_contains",
  "equals",
  "not_equals",
  "missing",
  "present",
] as const satisfies readonly StringComparator[];

export const DATE_COMPARATORS = [
  "before",
  "after",
  "between",
  "older_than",
  "newer_than",
  "missing",
  "present",
] as const satisfies readonly DateComparator[];

/** Map value-type → allowed comparator list. */
export const COMPARATORS_BY_TYPE: Record<
  SignalValueType,
  readonly Comparator[]
> = {
  numeric: NUMERIC_COMPARATORS,
  boolean: BOOLEAN_COMPARATORS,
  enum: ENUM_COMPARATORS,
  string: STRING_COMPARATORS,
  date: DATE_COMPARATORS,
};

/** True if `comparator` is valid for `type`. */
export function isValidComparator(
  type: SignalValueType,
  comparator: string,
): comparator is Comparator {
  return (COMPARATORS_BY_TYPE[type] as readonly string[]).includes(comparator);
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate a single comparator against an actual data value.
 * Returns:
 *   - `true` if the row matches the filter
 *   - `false` if the row does not match
 *
 * Edge cases:
 *   - `actual === undefined` is treated the same as `null` (absent).
 *   - For numeric comparators, non-finite numbers (NaN, ±Infinity) are absent.
 *   - For date comparators, strings + Date objects + epoch numbers are accepted.
 *   - Unknown comparators throw — callers should validate with
 *     {@link isValidComparator} first.
 */
export function evaluate(
  type: SignalValueType,
  comparator: Comparator,
  expected: FilterValue,
  actual: unknown,
): boolean {
  // Handle "presence" comparators uniformly across all types.
  if (comparator === "missing") return isAbsent(actual);
  if (comparator === "present") return !isAbsent(actual);

  // If the value is absent and we're not asking about presence, no match.
  if (isAbsent(actual)) return false;

  switch (type) {
    case "numeric":
      return evaluateNumeric(comparator as NumericComparator, expected, actual);
    case "boolean":
      return evaluateBoolean(comparator as BooleanComparator, expected, actual);
    case "enum":
      return evaluateEnum(comparator as EnumComparator, expected, actual);
    case "string":
      return evaluateString(comparator as StringComparator, expected, actual);
    case "date":
      return evaluateDate(comparator as DateComparator, expected, actual);
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown signal value type: ${String(_exhaustive)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isAbsent(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number" && !Number.isFinite(v)) return true;
  if (typeof v === "string" && v.length === 0) return true;
  return false;
}

function evaluateNumeric(
  op: NumericComparator,
  expected: FilterValue,
  actual: unknown,
): boolean {
  const a = toNumber(actual);
  if (a === null) return false;

  switch (op) {
    case "<": {
      const e = toNumber(expected);
      return e !== null && a < e;
    }
    case "<=": {
      const e = toNumber(expected);
      return e !== null && a <= e;
    }
    case "=": {
      const e = toNumber(expected);
      return e !== null && a === e;
    }
    case ">=": {
      const e = toNumber(expected);
      return e !== null && a >= e;
    }
    case ">": {
      const e = toNumber(expected);
      return e !== null && a > e;
    }
    case "between": {
      if (!Array.isArray(expected) || expected.length !== 2) return false;
      const lo = toNumber(expected[0]);
      const hi = toNumber(expected[1]);
      if (lo === null || hi === null) return false;
      // Inclusive both ends; tolerate reversed input.
      const [min, max] = lo <= hi ? [lo, hi] : [hi, lo];
      return a >= min && a <= max;
    }
    case "missing":
    case "present":
      // Handled in evaluate() before we get here.
      throw new Error(`Unreachable comparator: ${op}`);
    default: {
      const _exhaustive: never = op;
      throw new Error(`Unknown numeric comparator: ${String(_exhaustive)}`);
    }
  }
}

function evaluateBoolean(
  op: BooleanComparator,
  expected: FilterValue,
  actual: unknown,
): boolean {
  const a = toBoolean(actual);
  if (a === null) return false;
  const e = toBoolean(expected);
  if (e === null) return false;
  return op === "is" ? a === e : a !== e;
}

function evaluateEnum(
  op: EnumComparator,
  expected: FilterValue,
  actual: unknown,
): boolean {
  const a = String(actual);

  switch (op) {
    case "is":
      return typeof expected === "string" && a === expected;
    case "is_not":
      return typeof expected === "string" && a !== expected;
    case "is_one_of":
      return Array.isArray(expected) && expected.some((v) => String(v) === a);
    case "is_none_of":
      return Array.isArray(expected) && !expected.some((v) => String(v) === a);
    case "missing":
    case "present":
      throw new Error(`Unreachable enum comparator: ${op}`);
    default: {
      const _exhaustive: never = op;
      throw new Error(`Unknown enum comparator: ${String(_exhaustive)}`);
    }
  }
}

function evaluateString(
  op: StringComparator,
  expected: FilterValue,
  actual: unknown,
): boolean {
  const a = String(actual).toLowerCase();
  const e = typeof expected === "string" ? expected.toLowerCase() : "";
  if (op !== "missing" && op !== "present" && e.length === 0) return false;

  switch (op) {
    case "contains":
      return a.includes(e);
    case "not_contains":
      return !a.includes(e);
    case "equals":
      return a === e;
    case "not_equals":
      return a !== e;
    case "missing":
    case "present":
      throw new Error(`Unreachable string comparator: ${op}`);
    default: {
      const _exhaustive: never = op;
      throw new Error(`Unknown string comparator: ${String(_exhaustive)}`);
    }
  }
}

function evaluateDate(
  op: DateComparator,
  expected: FilterValue,
  actual: unknown,
): boolean {
  const a = toDate(actual);
  if (a === null) return false;

  switch (op) {
    case "before": {
      const e = toDate(expected);
      return e !== null && a.getTime() < e.getTime();
    }
    case "after": {
      const e = toDate(expected);
      return e !== null && a.getTime() > e.getTime();
    }
    case "between": {
      if (!Array.isArray(expected) || expected.length !== 2) return false;
      const lo = toDate(expected[0]);
      const hi = toDate(expected[1]);
      if (lo === null || hi === null) return false;
      const [min, max] = lo.getTime() <= hi.getTime() ? [lo, hi] : [hi, lo];
      return a.getTime() >= min.getTime() && a.getTime() <= max.getTime();
    }
    case "older_than": {
      // expected = days; matches if actual is more than N days old.
      const days = toNumber(expected);
      if (days === null) return false;
      const cutoff = Date.now() - days * 86_400_000;
      return a.getTime() < cutoff;
    }
    case "newer_than": {
      const days = toNumber(expected);
      if (days === null) return false;
      const cutoff = Date.now() - days * 86_400_000;
      return a.getTime() > cutoff;
    }
    case "missing":
    case "present":
      throw new Error(`Unreachable date comparator: ${op}`);
    default: {
      const _exhaustive: never = op;
      throw new Error(`Unknown date comparator: ${String(_exhaustive)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Coercion helpers — kept defensive so registry consumers can pass raw
// Prisma rows without pre-casting.
// ─────────────────────────────────────────────────────────────────────────────

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed.length === 0) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toBoolean(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "1") return true;
    if (s === "false" || s === "no" || s === "0") return false;
  }
  return null;
}

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "number") {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}
