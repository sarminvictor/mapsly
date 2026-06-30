/**
 * Agency · /usage → /team/billing redirect.
 *
 * The wallet + credit-ledger that used to live here is now part of the unified
 * "Billing & credits" page (app/[locale]/(agency)/team/billing). This route is
 * kept as a redirect so old links + the WalletPill's previous target keep
 * working. The AgencyChrome nav already maps both /usage and /team/billing to
 * the same "Billing" item.
 *
 * Per `.claude/rules/cache-components.md` Pattern 2 — sync default export, async
 * body in a Suspense boundary (the redirect reads the request locale).
 */

import { Suspense } from "react";

import { redirect } from "@/i18n/navigation";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default function UsagePage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <UsageRedirect params={params} />
    </Suspense>
  );
}

async function UsageRedirect({ params }: PageProps) {
  const { locale } = await params;
  redirect({ href: "/team/billing", locale });
  return null;
}
