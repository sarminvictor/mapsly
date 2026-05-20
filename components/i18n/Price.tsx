"use client";

import { useLocale } from "next-intl";

import type { Locale } from "@/i18n/routing";
import { formatPrice, type FormatPriceOptions } from "@/lib/i18n/format";

/**
 * Price · render a numeric amount as a localized currency string.
 *
 * Reads the active locale via `useLocale()` and defers to `formatPrice()`
 * from `lib/i18n/format` for the actual rendering.
 *
 * NOTE: this is a client component (uses `useLocale()` hook). For server
 * components, prefer calling `formatPrice()` from `@/lib/i18n/format`
 * directly with `await getLocale()` from `next-intl/server` — the pure
 * formatter has no React dependency.
 *
 * Examples (en-US):
 *   <Price amount={2999} />                 → $2,999.00
 *   <Price amount={29.99} currency="USD" /> → $29.99
 *
 * Examples (fr-CA):
 *   <Price amount={29.99} />                → 29,99 $
 *   <Price amount={29}    trimWhole />      → 29 $
 *
 * @see lib/i18n/format.ts · formatPrice
 */

export interface PriceProps extends FormatPriceOptions {
  /** The monetary value in the major currency unit (dollars, not cents). */
  amount: number | null | undefined;
  /** Override the locale rather than reading from `useLocale()`. */
  locale?: Locale | string;
  /** Shorthand for `trimWholeAmountFraction`. */
  trimWhole?: boolean;
  /** Optional className passed to the wrapping <span>. */
  className?: string;
}

export function Price({
  amount,
  locale: overrideLocale,
  trimWhole,
  trimWholeAmountFraction,
  className,
  ...rest
}: PriceProps) {
  const activeLocale = useLocale();
  const locale = overrideLocale ?? activeLocale;

  const formatted = formatPrice(amount, locale, {
    ...rest,
    trimWholeAmountFraction: trimWhole ?? trimWholeAmountFraction,
  });

  return <span className={className}>{formatted}</span>;
}
