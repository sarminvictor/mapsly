import { permanentRedirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

// /pricing removed for MVP · personal landings are the only sales surface.
// The route (and its translated paths /es/precios, /fr/tarifs — still
// registered in i18n/routing.ts) 308s to the locale home so old links and
// indexed URLs never 404.
export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect({ href: "/", locale: locale as Locale });
}
