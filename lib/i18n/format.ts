/**
 * Locale-aware formatters · pure functions (no React context).
 *
 * These produce stable strings via the platform `Intl.*` APIs so they work
 * identically in:
 *   - server components (call `formatPrice/formatDate` directly with the
 *     locale from `await getLocale()` from `next-intl/server`)
 *   - client components (paired with `useLocale()` from `next-intl`)
 *   - tests (snapshot per-locale outputs)
 *
 * Mapsly serves four locales (see `i18n/routing.ts`):
 *   - `en`     · en-US default · USD
 *   - `es`     · es-US         · USD
 *   - `en-CA`  · Canadian Eng. · CAD
 *   - `fr`     · fr-CA         · CAD
 *
 * Locale inputs accept BOTH the project's routing slugs (`en`, `fr`) AND the
 * BCP-47 region-tagged forms (`en-US`, `fr-CA`). `normalizeLocale()` collapses
 * the latter to the former so currency / fallback lookups never silently miss.
 */

import type { Locale } from "@/i18n/routing";

/* ------------------------------------------------------------------------ */
/* Locale normalization                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Collapse a locale input (BCP-47 or routing slug) to the canonical routing
 * slug used by `messages/*.json` and `CURRENCY_BY_LOCALE`.
 *
 *   normalizeLocale("en")    → "en"
 *   normalizeLocale("en-US") → "en"
 *   normalizeLocale("fr-CA") → "fr"
 *   normalizeLocale("en-CA") → "en-CA"  (this IS a routing slug)
 *   normalizeLocale("pt-BR") → "pt-BR"  (unknown · passed through)
 */
function normalizeLocale(input: Locale | string): string {
  switch (input) {
    case "en":
    case "en-US":
      return "en";
    case "es":
    case "es-US":
      return "es";
    case "en-CA":
      return "en-CA";
    case "fr":
    case "fr-CA":
      return "fr";
    default:
      return input;
  }
}

/* ------------------------------------------------------------------------ */
/* Currency · per-locale default                                            */
/* ------------------------------------------------------------------------ */

const CURRENCY_BY_SLUG: Record<Locale, "USD" | "CAD"> = {
  en: "USD",
  es: "USD",
  "en-CA": "CAD",
  fr: "CAD",
};

/**
 * Map a routing locale (or BCP-47 tag) to a BCP-47 tag the platform `Intl.*`
 * APIs understand.
 *
 * Our routing slugs (`en`, `es`, `fr`) are deliberately short for nicer URLs,
 * but `Intl.NumberFormat("fr")` would default to fr-FR formatting. We expand
 * to the audience-correct region tag here. Already-region-tagged inputs are
 * passed through unchanged.
 */
export function localeToBcp47(locale: Locale | string): string {
  switch (locale) {
    case "en":
      return "en-US";
    case "es":
      return "es-US";
    case "en-CA":
      return "en-CA";
    case "fr":
      return "fr-CA";
    default:
      return locale;
  }
}

/**
 * The default currency for a locale. Accepts routing slugs or BCP-47 tags.
 * Unknown locales fall back to USD (sensible default for a US-first product).
 */
export function defaultCurrencyForLocale(
  locale: Locale | string,
): "USD" | "CAD" {
  const slug = normalizeLocale(locale) as Locale;
  return (CURRENCY_BY_SLUG as Record<string, "USD" | "CAD">)[slug] ?? "USD";
}

/* ------------------------------------------------------------------------ */
/* Numbers                                                                   */
/* ------------------------------------------------------------------------ */

export interface FormatNumberOptions extends Intl.NumberFormatOptions {
  /** Render `null` / `undefined` / `NaN` as this string. Default: "—". */
  fallback?: string;
}

/**
 * Format a number for display. Falls back to a literal placeholder when the
 * value is missing — never renders raw `NaN` or `null`.
 */
export function formatNumber(
  value: number | null | undefined,
  locale: Locale | string,
  options: FormatNumberOptions = {},
): string {
  const { fallback = "—", ...rest } = options;
  if (value == null || Number.isNaN(value)) return fallback;
  return new Intl.NumberFormat(localeToBcp47(locale), rest).format(value);
}

/* ------------------------------------------------------------------------ */
/* Currency / price                                                          */
/* ------------------------------------------------------------------------ */

export interface FormatPriceOptions {
  /** ISO 4217 currency code. Defaults to `defaultCurrencyForLocale(locale)`. */
  currency?: "USD" | "CAD" | string;
  /** Minimum fraction digits. Default 2 unless the amount is a whole number. */
  minimumFractionDigits?: number;
  /** Maximum fraction digits. Default 2. */
  maximumFractionDigits?: number;
  /** Render `null` / `undefined` / `NaN` as this string. Default "—". */
  fallback?: string;
  /** Render whole amounts without ".00". Default false. */
  trimWholeAmountFraction?: boolean;
}

/**
 * Format an amount as a localized currency string.
 *
 * Examples:
 *   formatPrice(2999, "en")    → "$2,999.00"
 *   formatPrice(29.99, "fr")   → "29,99 $"        (NBSP between digits + symbol)
 *   formatPrice(29, "en-CA", { trimWholeAmountFraction: true }) → "$29"
 *
 * Implementation note: cross-ICU-version stability is best with explicit
 * fraction digits; without them, output varies between Node 22 / Node 24.
 */
export function formatPrice(
  amount: number | null | undefined,
  locale: Locale | string,
  options: FormatPriceOptions = {},
): string {
  const {
    currency = defaultCurrencyForLocale(locale),
    fallback = "—",
    trimWholeAmountFraction = false,
    minimumFractionDigits,
    maximumFractionDigits = 2,
  } = options;

  if (amount == null || Number.isNaN(amount)) return fallback;

  const isWhole = Number.isInteger(amount);
  const minFrac =
    minimumFractionDigits ?? (trimWholeAmountFraction && isWhole ? 0 : 2);

  return new Intl.NumberFormat(localeToBcp47(locale), {
    style: "currency",
    currency,
    minimumFractionDigits: minFrac,
    maximumFractionDigits,
  }).format(amount);
}

/* ------------------------------------------------------------------------ */
/* Dates                                                                     */
/* ------------------------------------------------------------------------ */

export type DateInput = Date | string | number;

function toDate(input: DateInput): Date | null {
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Named date styles · saves callers from re-specifying common shapes.
 *   - `short`     → "May 17"            (en) | "17 mai"           (fr)
 *   - `medium`    → "May 17, 2026"      (en) | "17 mai 2026"      (fr)
 *   - `long`      → "May 17, 2026"      (en) | "17 mai 2026"      (fr)
 *   - `weekday`   → "Sunday, May 17"    (en) | "dimanche 17 mai"  (fr)
 *   - `datetime`  → "May 17, 2026, 14:30" | "17 mai 2026, 14:30"
 *   - `time`      → "14:30"
 *
 * Callers wanting non-named shapes pass `options` directly.
 */
export type NamedDateStyle =
  | "short"
  | "medium"
  | "long"
  | "weekday"
  | "datetime"
  | "time";

const NAMED_STYLE_OPTIONS: Record<NamedDateStyle, Intl.DateTimeFormatOptions> =
  {
    short: { month: "short", day: "numeric" },
    medium: { year: "numeric", month: "short", day: "numeric" },
    long: { year: "numeric", month: "long", day: "numeric" },
    weekday: { weekday: "long", month: "long", day: "numeric" },
    datetime: {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    },
    time: { hour: "2-digit", minute: "2-digit", hour12: false },
  };

export interface FormatDateOptions {
  /** Named style preset (default: "medium"). Ignored when `options` is set. */
  style?: NamedDateStyle;
  /** Explicit Intl.DateTimeFormat options · overrides `style`. */
  options?: Intl.DateTimeFormatOptions;
  /** Render invalid / nullish dates as this string. Default "—". */
  fallback?: string;
}

/**
 * Format a date for display.
 *
 *   formatDate("2026-05-17T14:30:00Z", "en")                       → "May 17, 2026"
 *   formatDate("2026-05-17T14:30:00Z", "fr")                       → "17 mai 2026"
 *   formatDate("2026-05-17T14:30:00Z", "en", { style: "short" })   → "May 17"
 *   formatDate("2026-05-17T14:30:00Z", "fr", { style: "short" })   → "17 mai"
 *
 * IMPORTANT: When `options` includes `hour`/`minute` without `timeZone`,
 * the rendered time reflects the runtime time zone — tests pin this via
 * `timeZone: "UTC"`.
 */
export function formatDate(
  input: DateInput | null | undefined,
  locale: Locale | string,
  opts: FormatDateOptions = {},
): string {
  const { style = "medium", options, fallback = "—" } = opts;
  if (input == null) return fallback;
  const d = toDate(input);
  if (!d) return fallback;

  const effective = options ?? NAMED_STYLE_OPTIONS[style];
  return new Intl.DateTimeFormat(localeToBcp47(locale), effective).format(d);
}

/* ------------------------------------------------------------------------ */
/* Relative time                                                             */
/* ------------------------------------------------------------------------ */

export interface FormatRelativeTimeOptions {
  /** Reference "now". Defaults to `new Date()`. Tests pin this for stability. */
  now?: Date;
  /** Render invalid / nullish dates as this. Default "—". */
  fallback?: string;
  /**
   * Numeric style · "auto" yields "yesterday" / "in 2 days" where the locale
   * has a phrase; "always" forces "1 day ago" / "in 2 days". Default "auto".
   */
  numeric?: "auto" | "always";
}

interface Unit {
  unit: Intl.RelativeTimeFormatUnit;
  seconds: number;
}

const UNITS: Unit[] = [
  { unit: "year", seconds: 31_536_000 },
  { unit: "month", seconds: 2_592_000 },
  { unit: "week", seconds: 604_800 },
  { unit: "day", seconds: 86_400 },
  { unit: "hour", seconds: 3_600 },
  { unit: "minute", seconds: 60 },
  { unit: "second", seconds: 1 },
];

/**
 * Format a date as a relative phrase ("2 hours ago" / "il y a 2 heures").
 *
 *   formatRelativeTime(twoHoursAgo, "en")  → "2 hours ago"
 *   formatRelativeTime(twoHoursAgo, "fr")  → "il y a 2 heures"
 */
export function formatRelativeTime(
  input: DateInput | null | undefined,
  locale: Locale | string,
  opts: FormatRelativeTimeOptions = {},
): string {
  const { now = new Date(), fallback = "—", numeric = "auto" } = opts;
  if (input == null) return fallback;
  const d = toDate(input);
  if (!d) return fallback;

  const diffSeconds = Math.round((d.getTime() - now.getTime()) / 1000);
  const absDiff = Math.abs(diffSeconds);

  // Pick the largest unit whose magnitude is ≥1.
  const chosen =
    UNITS.find((u) => absDiff >= u.seconds) ?? UNITS[UNITS.length - 1]!;
  const value = Math.round(diffSeconds / chosen.seconds);

  return new Intl.RelativeTimeFormat(localeToBcp47(locale), {
    numeric,
  }).format(value, chosen.unit);
}
