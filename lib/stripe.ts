// Stripe client · lazy proxy per INC-2026-05-19-07.
//
// Stripe's constructor reads `STRIPE_SECRET_KEY` at instantiation, and
// Vercel's build phase doesn't always have runtime env vars. Constructing
// at module-top-level would crash `next build`.
//
// We mirror the `lib/prisma.ts` pattern: a Proxy that lazily instantiates
// the real client on first property access, and caches the instance on
// `globalThis.__stripe` so HMR / repeated imports share one socket pool.

import Stripe from "stripe";

declare global {
  // eslint-disable-next-line no-var
  var __stripe: Stripe | undefined;
}

/**
 * Stripe API version this app targets. Hard-pin per Stripe's recommendation
 * so node-stripe SDK upgrades don't silently shift response shapes under us.
 * Bump deliberately + add an INC- entry on the upgrade path.
 */
export const STRIPE_API_VERSION = "2024-12-18.acacia" as const;

function makeClient(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "STRIPE_SECRET_KEY not set — required at runtime. Set in Vercel project env or .env.local.",
    );
  }
  return new Stripe(secret, {
    // Cast: node-stripe types pin to the SDK's bundled version literal; ours
    // may lag by one release. Behaviour is identical for the calls we make.
    apiVersion: STRIPE_API_VERSION as unknown as Stripe.LatestApiVersion,
    typescript: true,
    appInfo: {
      name: "mapsly",
      url: "https://mapsly.ai",
    },
  });
}

function getClient(): Stripe {
  if (!globalThis.__stripe) {
    globalThis.__stripe = makeClient();
  }
  return globalThis.__stripe;
}

/**
 * Lazy-proxied Stripe client. First property access constructs the real
 * client; subsequent accesses reuse `globalThis.__stripe`. Safe to import
 * at build time — construction is deferred until actual API use.
 */
const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});

export default stripe;

/**
 * TEST ONLY · clears the cached client so tests can swap env vars between
 * cases without inheriting a stale instance. Production code never calls
 * this.
 */
export function __resetStripeForTest(): void {
  globalThis.__stripe = undefined;
}
