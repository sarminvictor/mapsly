/**
 * Signal type system · D.1
 *
 * A "signal" is one filterable, displayable, scoreable fact about a business.
 * Every signal in the registry conforms to {@link SignalDefinition}.
 *
 * See `.claude/rules/signal-engineering.md` for the canonical contract.
 */

/**
 * The 8 canonical signal categories. Keep stable — Hunter UI groups filters
 * by this enum. New categories are a design decision (see signal-engineering.md).
 */
export type SignalCategory =
  | "profile" //          1. Profile completeness (Maps fields)
  | "reviews" //          2. Reviews / reputation (Reviews API + AI)
  | "website" //          3. Website / Tech (Lighthouse + DOM)
  | "search" //           4. Search / Local SEO (SERP + GBP)
  | "ads" //              5. Ads / paid (Meta + Google)
  | "competitive" //      6. Competitive / geo (proximity, new entrants)
  | "qualifiers" //       7. Business qualifiers (revenue proxies)
  | "exclusions"; //      8. Exclusions (skip filters)

/**
 * Discriminator for what kind of value the signal holds.
 * Determines which comparators are valid and how the Hunter UI renders the
 * value editor.
 */
export type SignalValueType =
  | "numeric" //  number with units (rating, count, %, ms, seconds, dollars)
  | "boolean" // true/false
  | "enum" //    one of N string values
  | "string" //  free-form text (e.g. category name, tech-stack token)
  | "date"; //   ISO date or relative ("older_than 30d")

/**
 * Refresh cadence — must match the cron schedule per `docs/data-cadence.md`.
 * `static` means data never changes via cron (e.g. categories from
 * one-time indexer); `on-demand` means a user-triggered re-audit.
 */
export type SignalCadence =
  | "daily"
  | "weekly"
  | "monthly"
  | "on-demand"
  | "static";

/**
 * Where the data originates. Free-form string but conventionally:
 *   - `"dataforseo:maps"` / `"dataforseo:reviews"` / `"dataforseo:serp"` / `"dataforseo:lighthouse"`
 *   - `"meta-ad-library"` / `"google-ads-transparency"`
 *   - `"computed-from-reviews"` / `"computed-from-snapshots"`
 *   - `"internal"` (Mapsly-side: lists, leads, agency state)
 */
export type SignalSource = string;

/**
 * Comparator (operator) types per value type. The full list is in
 * `comparators.ts`. This union is the wire-level shape used by `FilterRow`.
 */
export type NumericComparator =
  | "<"
  | "<="
  | "="
  | ">="
  | ">"
  | "between"
  | "missing"
  | "present";

export type BooleanComparator = "is" | "is_not";

export type EnumComparator =
  | "is"
  | "is_not"
  | "is_one_of"
  | "is_none_of"
  | "missing"
  | "present";

export type StringComparator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "missing"
  | "present";

export type DateComparator =
  | "before"
  | "after"
  | "between"
  | "older_than"
  | "newer_than"
  | "missing"
  | "present";

export type Comparator =
  | NumericComparator
  | BooleanComparator
  | EnumComparator
  | StringComparator
  | DateComparator;

/**
 * One signal's canonical definition. The Hunter UI, the Prospect detail
 * view, and the cron jobs all read from this shape.
 */
export interface SignalDefinition {
  /** Stable snake_case key — used in filter wire format and DB references. */
  readonly key: string;
  /** Human-readable filter label. Tom (agency persona) reads this. */
  readonly label: string;
  /** Plain-English explanation + benchmark. Shown on hover/tooltip. */
  readonly helpTooltip: string;
  /** Which of the 8 categories this signal belongs to. */
  readonly category: SignalCategory;
  /** Value type — discriminator for comparators and UI editor. */
  readonly type: SignalValueType;
  /** Allowed comparator operations. Order = UI presentation order. */
  readonly comparators: readonly Comparator[];
  /** Unit suffix shown in UI (`%`, `ms`, `s`, `$`, `days`, etc.); optional. */
  readonly valueUnit?: string;
  /**
   * Default filter value when user adds this signal to a Hunter list.
   * Should be a "useful threshold" — e.g. 25 for reply_rate.
   */
  readonly defaultValue?: number | string | boolean | null;
  /**
   * For enum signals, the allowed values. UI renders as a multi-select.
   */
  readonly enumValues?: readonly string[];
  /** Where data comes from (see {@link SignalSource} examples). */
  readonly source: SignalSource;
  /** Refresh cadence (matches cron tier). */
  readonly cadence: SignalCadence;
  /**
   * Dot-notation reference into the Prisma model where this value lives,
   * e.g. `"BusinessSnapshot.replyRate"` or `"LighthouseAudit.lcp"`.
   * Used by the Hunter query builder + the Prospect detail surface.
   */
  readonly column: string;
  /**
   * Optional cost-per-business-per-refresh estimate in USD.
   * Helps the cost-discipline rule reason about new signals.
   */
  readonly costPerRefreshUsd?: number;
  /**
   * If true, this is an "exclusion" filter — Hunter treats it inverted
   * (rows matching are removed from the list).
   */
  readonly isExclusion?: boolean;
}

/**
 * Internal helper type: a value passed to a comparator. `between` and
 * `is_one_of` use tuple/array forms; everything else uses a scalar.
 */
export type FilterValue =
  | number
  | string
  | boolean
  | null
  | readonly [number, number] // for `between` (numeric)
  | readonly [string, string] // for `between` (date)
  | readonly string[]; //         for `is_one_of` / `is_none_of`

/**
 * The shape one filter row in a Hunter list takes on the wire.
 * (Stored as JSON on `List.filtersJson`.)
 */
export interface FilterRow {
  readonly signalKey: string;
  readonly comparator: Comparator;
  readonly value: FilterValue;
}
