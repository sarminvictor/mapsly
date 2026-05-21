/**
 * SMB settings · public types.
 *
 * Settings is a read-mostly surface for v1 (E.6). The page renders the
 * user's identity (email + name) plus the read-only Business identity
 * sourced from Google Business Profile (we do NOT let Maria edit
 * name/address/hours here — those are owned by Google and pulled by the
 * C.8/C.9 cron pipeline; editing them in Mapsly would just drift from
 * the source of truth). What WILL be editable in later iterations:
 *
 *   - Brand voice / reply tone (Business.replyTone — schema follow-up)
 *   - Notification preferences (UserNotificationPref — schema follow-up)
 *   - Locale preference (User.preferredLocale — schema follow-up; for
 *     now a session cookie set via the `LocaleSwitcher` below)
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, the EMPTY constant
 * matches the full shape of the declared interface so Vercel's build
 * worker can prerender the page without opening a Neon WebSocket.
 */

export interface SmbSettingsData {
  /**
   * Empty string when the viewer has no claimed business yet (post-signup
   * pre-onboarding state) OR we're in build-phase prerender OR the query
   * threw. Page renders the empty-state CTA for this case.
   */
  ownedBusinessId: string;
  /**
   * Business identity — read-only on the settings page. Source of truth
   * is Google Business Profile. Maria edits these in Google, Mapsly's
   * weekly cron syncs them back.
   */
  businessName: string;
  businessAddress: string | null;
  businessCity: string | null;
  businessProvince: string | null;
  businessCategory: string | null;
  businessWebsite: string | null;
  businessPhone: string | null;
  isClaimed: boolean;
  /**
   * Snapshot of the owner's identity. The user.email is the magic-link
   * identity — non-editable in v1 (changing it would orphan the session).
   */
  userEmail: string;
  userName: string | null;
}

export const EMPTY_SMB_SETTINGS: SmbSettingsData = {
  ownedBusinessId: "",
  businessName: "",
  businessAddress: null,
  businessCity: null,
  businessProvince: null,
  businessCategory: null,
  businessWebsite: null,
  businessPhone: null,
  isClaimed: false,
  userEmail: "",
  userName: null,
};
