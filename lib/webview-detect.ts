// In-app (embedded webview) browser detection — the client half of the fix
// for Google OAuth "Error 403: disallowed_useragent". Google categorically
// blocks its OAuth endpoint inside embedded webviews (LinkedIn/Facebook/
// Instagram/… in-app browsers); there is no server-side workaround, so the
// only remedy is to detect the webview and steer the user to the magic link
// (which works everywhere) or out to the system browser.
//
// DESIGN INVARIANT — real browsers must be untouched. This matcher fires ONLY
// on explicit app-identifying UA tokens (LinkedInApp, FBAN, Instagram, …). It
// deliberately does NOT match the bare Android "wv" WebView token or any
// "missing Safari token" heuristic: those over-match and would risk hiding the
// Google button in a legitimate browser. Every real Chrome/Safari/Firefox/
// Edge/Samsung UA contains none of these tokens → returns null → the caller
// renders the normal Google button. See lib/__tests__/webview-detect.test.ts,
// which asserts null for a broad set of real-browser UAs.

export type WebviewPlatform = "ios" | "android" | "other";

export interface InAppBrowser {
  /** Display name for the notice copy (proper noun, not translated). */
  app: string;
  platform: WebviewPlatform;
  /**
   * True when the `x-safari-https://` scheme reliably escapes to Safari
   * (iOS 17+ era) for THIS app. False for apps that block the scheme
   * (Facebook, TikTok, Snapchat) and for every non-iOS platform — those get
   * a copy-link + "open in your browser" path instead. Verified against the
   * 2025-2026 escape-support matrix (research 2026-07-16).
   */
  canOpenInSafari: boolean;
}

interface AppSignature {
  name: string;
  test: RegExp;
  /** x-safari-https:// escape works from this app on iOS 17+. */
  iosSafariEscape: boolean;
}

// High-confidence, app-specific tokens only. Ordered most-specific first so a
// single first-match wins (Instagram before the Facebook family, since some
// Instagram UAs also carry FB tokens).
const APPS: AppSignature[] = [
  { name: "LinkedIn", test: /LinkedInApp/i, iosSafariEscape: true },
  { name: "Instagram", test: /\bInstagram/i, iosSafariEscape: true },
  {
    name: "Facebook",
    test: /\b(FBAN|FBAV|FB_IAB|FBIOS|FB4A)\b/i,
    iosSafariEscape: false,
  },
  { name: "X", test: /\bTwitter\b/i, iosSafariEscape: true },
  {
    name: "TikTok",
    // No word boundaries around musical_ly: the real token is `musical_ly_2023`
    // and `_` is a word char, so a trailing \b would never match. TikTok and
    // BytedanceWebview keep their boundaries.
    test: /\bTikTok\b|musical_ly|\bBytedanceWebview\b/i,
    iosSafariEscape: false,
  },
  { name: "Snapchat", test: /\bSnapchat\b/i, iosSafariEscape: false },
  { name: "Line", test: /\bLine\//i, iosSafariEscape: true },
  { name: "WeChat", test: /\bMicroMessenger\b/i, iosSafariEscape: false },
  { name: "KakaoTalk", test: /\bKAKAOTALK\b/i, iosSafariEscape: false },
];

function platformOf(ua: string): WebviewPlatform {
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

/**
 * Returns the detected in-app browser, or null for real browsers (and for
 * compliant embedded views like SFSafariViewController / Chrome Custom Tabs,
 * whose UAs carry no app token and where Google OAuth works anyway).
 */
export function detectInAppBrowser(
  ua: string | null | undefined,
): InAppBrowser | null {
  if (!ua) return null;
  const match = APPS.find((a) => a.test.test(ua));
  if (!match) return null;
  const platform = platformOf(ua);
  return {
    app: match.name,
    platform,
    canOpenInSafari: platform === "ios" && match.iosSafariEscape,
  };
}
