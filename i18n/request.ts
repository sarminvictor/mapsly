import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  // For en-CA, fall back to en for missing keys
  const localeFile = locale === "en-CA" ? "en-CA" : locale;
  const baseFile = "en"; // always load en as the fallback

  const [messages, baseMessages] = await Promise.all([
    import(`../messages/${localeFile}.json`)
      .then((m) => m.default)
      .catch(() => ({})),
    import(`../messages/${baseFile}.json`).then((m) => m.default),
  ]);

  // Deep-merge fallback (en) under requested locale
  return {
    locale,
    messages: deepMerge(baseMessages, messages),
  };
});

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  overrides: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = deepMerge(
        (base[key] as Record<string, unknown>) ?? {},
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
