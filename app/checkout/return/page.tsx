// /checkout/return?session_id=cs_…
//
// Stripe's success_url after a direct-from-landing subscription. Reads the
// checkout session id and hands it to the client component, which auto-submits
// the post-payment login (validated server-side against Stripe). Lives OUTSIDE
// the [locale] tree (middleware bypasses /checkout) — a direct-share artifact
// like /l/[token].
//
// Per `.claude/rules/cache-components.md` Pattern 2/3: sync export + Suspense'd
// async body that awaits the uncached searchParams INSIDE the boundary.

import { Suspense } from "react";

import { CheckoutReturnLogin } from "./CheckoutReturnLogin";

export const metadata = {
  title: "Mapsly · finishing up",
  robots: { index: false, follow: false },
  // Don't leak the session_id (in the URL) to any sub-resource via Referer.
  referrer: "no-referrer" as const,
};

export default function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <ReturnBody searchParams={searchParams} />
    </Suspense>
  );
}

async function ReturnBody({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const sp = await searchParams;
  const sessionId = typeof sp.session_id === "string" ? sp.session_id : "";
  return <CheckoutReturnLogin sessionId={sessionId} />;
}
