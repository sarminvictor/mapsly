// POST /api/payments/webhook
//
// Alias for the canonical Stripe webhook handler at /api/webhooks/stripe. The
// production Stripe account's webhook endpoint is configured to point here, so
// we re-export the same verified + idempotent handler rather than duplicate it.
// Both paths run identical logic; keep them in sync via this single re-export.

export { POST } from "@/app/api/webhooks/stripe/route";
