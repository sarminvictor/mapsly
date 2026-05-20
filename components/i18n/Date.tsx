"use client";

import { useLocale } from "next-intl";
import * as React from "react";

import type { Locale } from "@/i18n/routing";
import {
  formatDate,
  formatRelativeTime,
  type DateInput,
  type FormatRelativeTimeOptions,
  type NamedDateStyle,
} from "@/lib/i18n/format";

/**
 * LocaleDate · render a Date/ISO-string with locale-aware formatting.
 *
 * Reads the active locale via `useLocale()` and defers to `formatDate()` (or
 * `formatRelativeTime()` when `mode="relative"`) from `lib/i18n/format`.
 *
 * NOTE: file is `Date.tsx` (per PLAN.md I.5) but the export is `LocaleDate`
 * to avoid shadowing the global `Date` constructor in calling code.
 *
 * Examples (en-US):
 *   <LocaleDate value="2026-05-17T14:30Z" />                 → May 17, 2026
 *   <LocaleDate value="2026-05-17T14:30Z" style="short" />   → May 17
 *   <LocaleDate value={fiveMinAgo} mode="relative" />        → 5 minutes ago
 *
 * Examples (fr-CA):
 *   <LocaleDate value="2026-05-17T14:30Z" />                 → 17 mai 2026
 *   <LocaleDate value="2026-05-17T14:30Z" style="short" />   → 17 mai
 *
 * @see lib/i18n/format.ts
 */

export interface LocaleDateProps {
  /** The date to render. ISO string, epoch ms, or Date instance. */
  value: DateInput | null | undefined;
  /** Format preset · default "medium". Ignored when `options` provided. */
  style?: NamedDateStyle;
  /** Explicit Intl.DateTimeFormat options · overrides `style`. */
  options?: Intl.DateTimeFormatOptions;
  /** "absolute" (default) renders a calendar date · "relative" renders "2 hours ago". */
  mode?: "absolute" | "relative";
  /** When `mode="relative"`, options passed to formatRelativeTime. */
  relativeOptions?: FormatRelativeTimeOptions;
  /** Override the locale rather than reading from `useLocale()`. */
  locale?: Locale | string;
  /** Fallback rendered for null/invalid input. Default "—". */
  fallback?: string;
  /** Optional className applied to the wrapping <time> element. */
  className?: string;
  /** Inline style applied to the wrapping <time> element. */
  htmlStyle?: React.CSSProperties;
}

export function LocaleDate({
  value,
  style = "medium",
  options,
  mode = "absolute",
  relativeOptions,
  locale: overrideLocale,
  fallback = "—",
  className,
  htmlStyle,
}: LocaleDateProps) {
  const activeLocale = useLocale();
  const locale = overrideLocale ?? activeLocale;

  const formatted =
    mode === "relative"
      ? formatRelativeTime(value, locale, { ...relativeOptions, fallback })
      : formatDate(value, locale, { style, options, fallback });

  // `dateTime` attribute on <time> for assistive tech + microformats.
  let isoAttr: string | undefined;
  if (value != null) {
    const d = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(d.getTime())) isoAttr = d.toISOString();
  }

  return (
    <time className={className} style={htmlStyle} dateTime={isoAttr}>
      {formatted}
    </time>
  );
}
