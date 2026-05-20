/**
 * Locale-aware presentational components.
 *
 * Thin wrappers around the pure formatters in `@/lib/i18n/format` so callers
 * don't have to plumb the active locale through every render path.
 */

export { Price } from "./Price";
export type { PriceProps } from "./Price";

export { LocaleDate } from "./Date";
export type { LocaleDateProps } from "./Date";
