import { describe, expect, test } from "vitest";

import { detectInAppBrowser } from "../webview-detect";

// The load-bearing invariant: real browsers are NEVER flagged, so the caller
// renders the normal Google button unchanged. If any of these regress, the
// Google button would vanish for legitimate users — a worse bug than the one
// we're fixing.
describe("detectInAppBrowser · real browsers return null (behavior unchanged)", () => {
  const REAL_BROWSERS: [string, string][] = [
    [
      "Chrome desktop",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    ],
    [
      "Safari macOS",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    ],
    [
      "Safari iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    ],
    [
      "Chrome Android",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    ],
    [
      "Chrome iOS (CriOS)",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
    ],
    [
      "Firefox desktop",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    ],
    [
      "Firefox iOS (FxiOS)",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
    ],
    [
      "Edge",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.61",
    ],
    [
      "Samsung Internet",
      "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
    ],
    [
      // Gmail opens links in SFSafariViewController (iOS) / Custom Tabs
      // (Android) — compliant, no app token, Google OAuth works. Must be null.
      "SFSafariViewController-class (plain Safari UA)",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    ],
    [
      // Bare Android WebView token — deliberately NOT matched (over-matches).
      "Android WebView with no app marker",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36",
    ],
  ];

  test.each(REAL_BROWSERS)("%s → null", (_name, ua) => {
    expect(detectInAppBrowser(ua)).toBeNull();
  });

  test("null/empty/undefined UA → null", () => {
    expect(detectInAppBrowser(null)).toBeNull();
    expect(detectInAppBrowser(undefined)).toBeNull();
    expect(detectInAppBrowser("")).toBeNull();
  });
});

describe("detectInAppBrowser · in-app browsers are detected", () => {
  test("LinkedIn iOS → offers Safari escape", () => {
    const r = detectInAppBrowser(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_7_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1 [LinkedInApp]/9.24.3895",
    );
    expect(r).toEqual({
      app: "LinkedIn",
      platform: "ios",
      canOpenInSafari: true,
    });
  });

  test("LinkedIn Android → detected, no Safari escape", () => {
    const r = detectInAppBrowser(
      "Mozilla/5.0 (Linux; Android 16; SM-S711B Build/BP4A.251205.006; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/149.0.7827.91 Mobile Safari/537.36 [LinkedInApp]/2.292.91",
    );
    expect(r).toEqual({
      app: "LinkedIn",
      platform: "android",
      canOpenInSafari: false,
    });
  });

  test("Instagram iOS → detected, Safari escape", () => {
    const r = detectInAppBrowser(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0.0 (iPhone14,3; iOS 17_5; en_US)",
    );
    expect(r?.app).toBe("Instagram");
    expect(r?.canOpenInSafari).toBe(true);
  });

  test("Facebook iOS → detected, NO Safari escape (scheme blocked)", () => {
    const r = detectInAppBrowser(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0]",
    );
    expect(r?.app).toBe("Facebook");
    expect(r?.canOpenInSafari).toBe(false);
  });

  test("TikTok Android → detected", () => {
    const r = detectInAppBrowser(
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36 musical_ly_2023 BytedanceWebview/d8a21c6",
    );
    expect(r?.app).toBe("TikTok");
    expect(r?.platform).toBe("android");
  });

  test("TikTok iOS via the musical_ly token alone → detected", () => {
    // Isolates the musical_ly branch (no TikTok/BytedanceWebview token), which
    // the trailing-\b regex used to miss because of the trailing "_2024".
    const r = detectInAppBrowser(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_2024",
    );
    expect(r?.app).toBe("TikTok");
    expect(r?.platform).toBe("ios");
  });
});
