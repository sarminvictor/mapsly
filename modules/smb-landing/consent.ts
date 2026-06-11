/**
 * Landing ad-pixel consent · pure helpers (plan #7).
 *
 * Single source of truth for the `mapsly_consent` first-party cookie that the
 * /l consent bar writes and the retargeting-pixels component reads:
 *
 *   mapsly_consent = encodeURIComponent(JSON.stringify({
 *     v: 1, ads: boolean, analytics: boolean, ts: ISO8601
 *   }))  · max-age 31536000 · path=/ · SameSite=Lax
 *
 * The first-party /api/landing-events beacon stays consent-UNGATED (first-party
 * measurement, salted ipHash, no third-party sharing) — this cookie gates ONLY
 * the third-party ad pixels (Meta fbq · Google gtag), which load exclusively
 * when `ads === true` AND the matching NEXT_PUBLIC_* env id is set.
 *
 * Pure module — no DOM, no I/O — so the gating logic is unit-testable in the
 * node test env (modules/smb-landing/__tests__/consent.test.ts).
 */

export const CONSENT_COOKIE_NAME = "mapsly_consent";

/** One year, per the architect's storage contract. */
export const CONSENT_COOKIE_MAX_AGE = 31536000;

/** Custom DOM event the consent bar dispatches after writing the cookie, so
 * an already-mounted pixels component can react without a reload. */
export const CONSENT_EVENT = "mapsly:consent";

export interface LandingConsent {
  v: 1;
  ads: boolean;
  analytics: boolean;
  ts: string; // ISO8601 — when the visitor made the choice
}

/** Build a fresh consent record from a single accept/decline choice. */
export function makeConsent(
  accepted: boolean,
  now = new Date(),
): LandingConsent {
  return { v: 1, ads: accepted, analytics: accepted, ts: now.toISOString() };
}

/**
 * Serialize for a `document.cookie =` assignment. SameSite=Lax + path=/ so
 * every /l page (and the /cookies disclosure page) sees the same choice.
 */
export function serializeConsentCookie(consent: LandingConsent): string {
  return `${CONSENT_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(consent))}; max-age=${CONSENT_COOKIE_MAX_AGE}; path=/; SameSite=Lax`;
}

/**
 * Parse the consent record out of a raw cookie string (`document.cookie`).
 * Returns null when absent, malformed, or not the shape we wrote — a null
 * means "no choice recorded yet" and the bar should show.
 */
export function parseConsentCookie(
  cookieString: string | null | undefined,
): LandingConsent | null {
  if (!cookieString) return null;
  const pair = cookieString
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${CONSENT_COOKIE_NAME}=`));
  if (!pair) return null;
  try {
    const raw = decodeURIComponent(pair.slice(CONSENT_COOKIE_NAME.length + 1));
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object") return null;
    const c = parsed as Record<string, unknown>;
    if (c.v !== 1) return null;
    if (typeof c.ads !== "boolean") return null;
    if (typeof c.analytics !== "boolean") return null;
    if (typeof c.ts !== "string") return null;
    return { v: 1, ads: c.ads, analytics: c.analytics, ts: c.ts };
  } catch {
    return null;
  }
}

/**
 * THE pixel gate. A third-party pixel id is returned only when the visitor
 * explicitly accepted ads cookies AND the env id exists — otherwise null
 * (component renders nothing; we ship before Viktor creates the ad accounts).
 */
export function pixelsToLoad(
  consent: LandingConsent | null,
  metaPixelId: string | undefined,
  googleAdsId: string | undefined,
): { meta: string | null; google: string | null } {
  if (!consent || consent.ads !== true) return { meta: null, google: null };
  return {
    meta: metaPixelId && metaPixelId.trim() !== "" ? metaPixelId : null,
    google: googleAdsId && googleAdsId.trim() !== "" ? googleAdsId : null,
  };
}
