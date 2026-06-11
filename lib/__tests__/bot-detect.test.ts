import { describe, expect, test } from "vitest";

import {
  BOT_REASON,
  classifyLandingVisit,
  classifyUserAgent,
  isPrefetchOpen,
  isProxyOpenUserAgent,
  isScannerUserAgent,
  PREFETCH_WINDOW_SECONDS,
} from "../bot-detect";

const HUMAN_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

describe("isScannerUserAgent", () => {
  test.each([
    "Barracuda Sentinel (EE)",
    "Mozilla/5.0 (compatible; proofpoint; +https://www.proofpoint.com)",
    "Mimecast-Scanner/1.0",
    "Mozilla/5.0 (Windows NT 10.0) Microsoft Office Existence Discovery",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "BingPreview/1.0b",
    "python-requests/2.31.0",
    "curl/8.4.0",
    "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0",
  ])("flags %s", (ua) => {
    expect(isScannerUserAgent(ua)).toBe(true);
  });

  test("does not flag a real mobile Safari UA", () => {
    expect(isScannerUserAgent(HUMAN_UA)).toBe(false);
  });
});

describe("isProxyOpenUserAgent", () => {
  test("flags Gmail's image proxy", () => {
    expect(
      isProxyOpenUserAgent(
        "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)",
      ),
    ).toBe(true);
  });

  test("flags YahooMailProxy", () => {
    expect(isProxyOpenUserAgent("YahooMailProxy; https://help.yahoo.com")).toBe(
      true,
    );
  });

  test("does not flag a human UA", () => {
    expect(isProxyOpenUserAgent(HUMAN_UA)).toBe(false);
  });
});

describe("classifyUserAgent", () => {
  test("scanner UA → ua-scanner", () => {
    expect(classifyUserAgent("Mimecast-Scanner/1.0")).toEqual({
      isBot: true,
      reason: BOT_REASON.UA_SCANNER,
    });
  });

  test("proxy UA → ua-proxy", () => {
    expect(classifyUserAgent("x (via ggpht.com GoogleImageProxy)")).toEqual({
      isBot: true,
      reason: BOT_REASON.UA_PROXY,
    });
  });

  test("human UA → not a bot, no reason", () => {
    expect(classifyUserAgent(HUMAN_UA)).toEqual({ isBot: false, reason: null });
  });

  test("empty UA is NOT flagged (engagement rule catches it)", () => {
    expect(classifyUserAgent("")).toEqual({ isBot: false, reason: null });
  });
});

describe("isPrefetchOpen", () => {
  const sentAt = new Date("2026-06-10T12:00:00Z");

  test(`open < ${PREFETCH_WINDOW_SECONDS}s after send is prefetch even with a human UA`, () => {
    expect(
      isPrefetchOpen({
        sentAt,
        openedAt: new Date(sentAt.getTime() + 3_000),
        userAgent: HUMAN_UA,
      }),
    ).toBe(true);
  });

  test("late open via Gmail proxy is still prefetch-suspect", () => {
    expect(
      isPrefetchOpen({
        sentAt,
        openedAt: new Date(sentAt.getTime() + 3_600_000),
        userAgent: "x (via ggpht.com GoogleImageProxy)",
      }),
    ).toBe(true);
  });

  test("late open with a human UA is NOT prefetch", () => {
    expect(
      isPrefetchOpen({
        sentAt,
        openedAt: new Date(sentAt.getTime() + 60_000),
        userAgent: HUMAN_UA,
      }),
    ).toBe(false);
  });
});

describe("classifyLandingVisit", () => {
  test("page open + section view + human UA = human", () => {
    expect(
      classifyLandingVisit({
        hasPageOpened: true,
        sectionViewedCount: 3,
        userAgent: HUMAN_UA,
      }),
    ).toEqual({ isHuman: true, reason: null });
  });

  test("page open with zero section views = no-engagement (scanners don't scroll)", () => {
    expect(
      classifyLandingVisit({
        hasPageOpened: true,
        sectionViewedCount: 0,
        userAgent: HUMAN_UA,
      }),
    ).toEqual({ isHuman: false, reason: BOT_REASON.NO_ENGAGEMENT });
  });

  test("scanner UA loses even with engagement events", () => {
    expect(
      classifyLandingVisit({
        hasPageOpened: true,
        sectionViewedCount: 2,
        userAgent: "Barracuda Sentinel (EE)",
      }),
    ).toEqual({ isHuman: false, reason: BOT_REASON.UA_SCANNER });
  });

  test("no page open at all", () => {
    expect(
      classifyLandingVisit({
        hasPageOpened: false,
        sectionViewedCount: 0,
        userAgent: HUMAN_UA,
      }),
    ).toEqual({ isHuman: false, reason: BOT_REASON.NO_PAGE_OPEN });
  });
});
