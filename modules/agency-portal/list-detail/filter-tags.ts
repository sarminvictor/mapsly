/**
 * Convert a `List.filterJson` payload into human-readable filter tag
 * chips for the "filters used" card on `/(agency)/lists/[id]`.
 *
 * The full Hunter filter engine landed in D.4. For the list-detail
 * surface we don't re-evaluate filters — we just SHOW them so Tom
 * knows what defines this list. The signal registry (D.1) has the
 * canonical human-readable labels per signal id; we fall back to the
 * raw signal id when no registry entry matches so the UI never
 * breaks on unknown signals.
 *
 * The filterJson shape evolved across phases. We keep the parser
 * defensive — it handles any of:
 *
 *   1. `{ rules: [{ id, op, value, exclude? }, ...] }`
 *   2. `[{ id, op, value, exclude? }, ...]`
 *   3. `null` / `undefined` / wrong type · returns []
 *
 * Output is the canonical `AgencyListDetailFilterTag[]` (typed in
 * `./types.ts`) — one entry per filter row, each with a stable `id`
 * for React keys.
 */

import type { AgencyListDetailFilterTag } from "./types";

/** Best-effort comparator → glyph. Falls through unrecognised values. */
function comparatorGlyph(op: string): string {
  switch (op) {
    case "lt":
      return "<";
    case "lte":
    case "le":
      return "≤";
    case "gt":
      return ">";
    case "gte":
    case "ge":
      return "≥";
    case "eq":
      return "=";
    case "neq":
    case "ne":
      return "≠";
    case "between":
      return "↔";
    case "missing":
      return ": missing";
    case "present":
      return ": present";
    case "in":
      return ": one of";
    default:
      return op;
  }
}

/**
 * Plain-English labels for the most common signal ids — defines the
 * subset of the signal registry we render in the chips card. Unknown
 * signal ids fall back to their raw id (e.g. `lh_lcp_ms`) which is
 * still scannable for Tom.
 */
const SIGNAL_LABELS: Record<string, string> = {
  // Target / scope
  category: "category",
  metro: "metro",
  city: "city",
  radius_mi: "radius",
  country: "country",
  // Lighthouse
  lh_performance: "Lighthouse Perf",
  lh_seo: "Lighthouse SEO",
  lh_accessibility: "Lighthouse A11y",
  lh_best_practices: "Lighthouse Best Practices",
  lh_lcp_ms: "LCP",
  lh_cls: "CLS",
  lh_inp_ms: "INP",
  lh_fcp_ms: "FCP",
  lh_ttfb_ms: "TTFB",
  // Search / SEO
  has_local_business_schema: "LocalBusiness schema",
  has_faq_schema: "FAQ schema",
  has_review_schema: "Review schema",
  serp_local_pack_rank: "3-pack rank",
  serp_organic_rank: "organic rank",
  // Reviews
  rating: "rating",
  review_count: "reviews",
  owner_reply_rate: "reply rate",
  unanswered_1star: "unanswered 1★",
  // Ads
  has_meta_ads_active: "Meta ads active",
  has_google_ads_active: "Google Ads active",
  // Profile
  is_claimed: "GBP claimed",
  has_website: "website present",
  has_email_verified: "email verified",
  email_verified: "email verified",
  // Competitive / proximity
  competitor_within_radius_mi: "competitor within",
  // Business qualifiers
  years_in_business: "years",
  // NAP
  nap_consistent: "NAP",
  // Exclusions
  exclude_existing_clients: "existing clients",
};

/** True when the value looks "boolean-ish" — used to format `is_claimed = true`. */
function formatValue(value: unknown, op: string): string {
  if (op === "missing" || op === "present") return "";
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "number") {
    // Render integer-ish as integer; otherwise 1 decimal.
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  return String(value);
}

/** Coerce one raw rule into a chip. Returns null when the rule is unusable. */
function ruleToTag(
  raw: unknown,
  index: number,
): AgencyListDetailFilterTag | null {
  if (raw == null || typeof raw !== "object") return null;
  const rule = raw as Record<string, unknown>;

  const signal =
    typeof rule.id === "string"
      ? rule.id
      : typeof rule.signal === "string"
        ? rule.signal
        : typeof rule.key === "string"
          ? rule.key
          : null;
  if (!signal) return null;

  const op =
    typeof rule.op === "string"
      ? rule.op
      : typeof rule.comparator === "string"
        ? rule.comparator
        : "eq";

  const value = rule.value ?? rule.v ?? null;
  const exclude = rule.exclude === true || rule.negate === true;

  const human = SIGNAL_LABELS[signal] ?? signal;
  const glyph = comparatorGlyph(op);
  const formatted = formatValue(value, op);

  // Compose the chip text. Special-case `:` colon-style operators
  // (missing/present) where the value is empty.
  let label: string;
  if (op === "missing" || op === "present") {
    label = `${human}${glyph}`;
  } else if (signal === "exclude_existing_clients" || exclude) {
    // Always read as "exclude X" — the canonical exclude signal IS an
    // exclude (we use "existing clients" as the human label), and any
    // other signal with exclude=true also gets the `exclude ` prefix.
    label = `exclude ${human}`;
  } else if (formatted === "") {
    label = `${human} ${glyph}`.trim();
  } else if (glyph === "=" || glyph === ": one of") {
    label = `${human} ${glyph} ${formatted}`;
  } else {
    label = `${human} ${glyph} ${formatted}`;
  }

  return {
    id: `${signal}-${index}`,
    label,
    exclude,
  };
}

/**
 * Parse `List.filterJson` into the chip array rendered by
 * `FilterTagsCard`. Always returns an array (never throws).
 */
export function parseFilterTags(
  filterJson: unknown,
): AgencyListDetailFilterTag[] {
  if (filterJson == null) return [];

  // Shape 2 · raw array.
  if (Array.isArray(filterJson)) {
    return filterJson
      .map((r, i) => ruleToTag(r, i))
      .filter((t): t is AgencyListDetailFilterTag => t !== null);
  }

  // Shape 1 · { rules: [...] }
  if (typeof filterJson === "object") {
    const root = filterJson as Record<string, unknown>;
    const rules = Array.isArray(root.rules) ? root.rules : null;
    if (rules) {
      return rules
        .map((r, i) => ruleToTag(r, i))
        .filter((t): t is AgencyListDetailFilterTag => t !== null);
    }
  }

  return [];
}
