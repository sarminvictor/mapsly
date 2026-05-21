/**
 * Locale root layout · sync shell + async provider in <Suspense>.
 *
 * Per `.claude/rules/cache-components.md` Pattern 2, layouts that `await`
 * uncached request data (params, getMessages) MUST live inside a Suspense
 * boundary — otherwise descendant routes that don't enumerate all dynamic
 * params (e.g. `/biz/[slug]` which can't list every business) trip
 * `cacheComponents` E_BLOCKING_ROUTE at build time even when the page
 * itself wraps its body in Suspense. The error stack walks up to body/html
 * because layout-level awaits run BEFORE the page's Suspense ever exists
 * in the React tree.
 *
 * The fix: render the outer `<NextIntlClientProvider>` lazily — keep the
 * default export sync so the prerender shell is empty, and resolve
 * messages + locale inside a Suspense'd async child. For static routes
 * (locale enumerated via generateStaticParams), the async resolves
 * synchronously during prerender; for dynamic descendant routes, the
 * Suspense correctly defers without blocking the route's static portion.
 *
 * Cites: INC-2026-05-21 (B.5 build E_BLOCKING_ROUTE), cache-components.md
 * Pattern 2.
 */
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { setRequestLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { routing, type Locale } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // Sync shell — no awaits. Suspense boundary lets descendant dynamic
  // routes prerender their static portions without the locale provider's
  // i18n machinery blocking the prerender.
  return (
    <Suspense fallback={null}>
      <LocaleProvider params={params}>{children}</LocaleProvider>
    </Suspense>
  );
}

async function LocaleProvider({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as Locale)) notFound();

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      {children}
    </NextIntlClientProvider>
  );
}
