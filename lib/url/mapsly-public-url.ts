/**
 * Single source of truth for "where do callbacks / pingbacks find us?"
 *
 * Used by:
 *   - services/dataforseo/reviews-task.ts → builds DfS pingback URL
 *   - app/(admin)/admin/discovery/actions.ts → Boxly Worker callback URL
 *   - app/(admin)/admin/businesses/actions.ts → Worker callback URL (R.81)
 *   - app/api/cron/weekly/reviews-delta/route.ts → Worker callback URL (R.81)
 *
 * Resolution order:
 *   1. MAPSLY_PUBLIC_URL (explicit · set in production)
 *   2. https://{VERCEL_URL} (preview deploys auto-set this)
 *   3. http://localhost:3000 (dev fallback)
 *
 * Apex → www rewrite · INC-2026-05-xx (Vercel 307 redirects on apex
 * drop Authorization headers + query state on cross-host). Force www so
 * pingbacks / callbacks land at the canonical host directly.
 */
export function getMapslyPublicUrl(): string {
  const raw =
    process.env.MAPSLY_PUBLIC_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    "http://localhost:3000";
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed
    .replace(/^https?:\/\/mapsly\.ai(?=$|\/)/i, "https://www.mapsly.ai")
    .replace(/^https?:\/\/dev\.mapsly\.ai(?=$|\/)/i, "https://dev.mapsly.ai");
}
