/**
 * Tests · /admin/landing-pages funnel math (plan #17).
 *
 * Pure pieces only: `summarizeLandingSessions` (raw vs human split over
 * mixed bot/human session fixtures, using the REAL lib/bot-detect
 * classifier) and `gateVerdict` (the verdict-window logic over
 * lib/funnel-thresholds results). The SQL aggregation itself needs a live
 * DB — covered in production, per the cron-runs queries precedent.
 */

import { describe, expect, test, vi } from "vitest";

// queries.ts imports @/lib/prisma at module scope — stub it (never called by
// the pure helpers under test).
vi.mock("@/lib/prisma", () => ({ default: {} }));

import {
  evaluateFunnelGates,
  VERDICT_MIN_SENDS,
} from "@/lib/funnel-thresholds";

import {
  gateVerdict,
  summarizeLandingSessions,
  type LandingSessionAgg,
} from "../queries";

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SCANNER_UA = "Mozilla/5.0 (compatible; Mimecast LinkScan)";

function session(overrides: Partial<LandingSessionAgg>): LandingSessionAgg {
  return {
    sessionKey: `s_${Math.random().toString(36).slice(2, 8)}`,
    visitorId: null,
    userAgent: CHROME_UA,
    hasPageOpened: false,
    sectionViews: 0,
    pastHero: false,
    reachedPricing: false,
    ctaClicked: false,
    freeSignup: false,
    checkoutOpened: false,
    subscribedCount: 0,
    ...overrides,
  };
}

const step = (f: ReturnType<typeof summarizeLandingSessions>, id: string) => {
  const s = f.steps.find((x) => x.id === id);
  if (!s) throw new Error(`missing step ${id}`);
  return s;
};

describe("summarizeLandingSessions · mixed bot/human fixtures", () => {
  const fixtures: LandingSessionAgg[] = [
    // Human 1 · full journey to checkout.
    session({
      sessionKey: "s_h1",
      visitorId: "v_h1",
      hasPageOpened: true,
      sectionViews: 5,
      pastHero: true,
      reachedPricing: true,
      ctaClicked: true,
      checkoutOpened: true,
    }),
    // Human 2 · engaged via the free weekly-score signup.
    session({
      sessionKey: "s_h2",
      visitorId: "v_h2",
      hasPageOpened: true,
      sectionViews: 2,
      pastHero: true,
      freeSignup: true,
    }),
    // Scanner · opened + "scrolled" + even clicked — UA gives it away.
    session({
      sessionKey: "s_bot",
      visitorId: "v_bot",
      userAgent: SCANNER_UA,
      hasPageOpened: true,
      sectionViews: 3,
      ctaClicked: true,
    }),
    // No-engagement · real-looking UA, opened, zero section views.
    session({
      sessionKey: "s_idle",
      visitorId: "v_idle",
      hasPageOpened: true,
      sectionViews: 0,
    }),
    // Server-emitted subscription event w/o a browsing session.
    session({
      sessionKey: "evt_sub",
      userAgent: "",
      subscribedCount: 1,
    }),
  ];

  const f = summarizeLandingSessions(fixtures);

  test("raw vs human per step", () => {
    expect(step(f, "opened")).toMatchObject({ raw: 4, human: 2 });
    expect(step(f, "section")).toMatchObject({ raw: 3, human: 2 });
    expect(step(f, "engaged")).toMatchObject({ raw: 3, human: 2 });
    expect(step(f, "checkout")).toMatchObject({ raw: 1, human: 1 });
    // Server-truth: raw = human = event count.
    expect(step(f, "subscribed")).toMatchObject({ raw: 1, human: 1 });
  });

  test("session + bot-reason breakdown (#17b)", () => {
    expect(f.sessions).toBe(5);
    expect(f.nonHumanSessions).toBe(3);
    expect(f.botReasons).toEqual({
      "ua-scanner": 1,
      "no-engagement": 1,
      "no-page-open": 1,
    });
  });

  test("gate numerators are human-only", () => {
    expect(f.humanPageVisits).toBe(2);
    expect(f.humanEngaged).toBe(2);
    expect(f.paid).toBe(1);
  });

  test("section depth counts humans only", () => {
    // Scanner had sectionViews but is excluded.
    expect(f.sectionDepth).toEqual({ pastHero: 2, reachedPricing: 1 });
  });
});

describe("summarizeLandingSessions · visitor identity", () => {
  test("one visitor across human + bot sessions counts once, as human", () => {
    const f = summarizeLandingSessions([
      session({
        sessionKey: "s_1",
        visitorId: "v_1",
        hasPageOpened: true,
        sectionViews: 1,
      }),
      session({
        sessionKey: "s_2",
        visitorId: "v_1",
        userAgent: SCANNER_UA,
        hasPageOpened: true,
        sectionViews: 1,
        ctaClicked: true,
      }),
    ]);
    expect(step(f, "opened")).toMatchObject({ raw: 1, human: 1 });
    // Engagement unions across the visitor's sessions.
    expect(step(f, "engaged")).toMatchObject({ raw: 1, human: 1 });
    expect(f.nonHumanSessions).toBe(1);
  });

  test("missing visitorId falls back to the session key (counts once)", () => {
    const f = summarizeLandingSessions([
      session({ sessionKey: "s_a", hasPageOpened: true, sectionViews: 1 }),
      session({ sessionKey: "s_b", hasPageOpened: true, sectionViews: 1 }),
    ]);
    expect(step(f, "opened")).toMatchObject({ raw: 2, human: 2 });
  });

  test("empty input → all zeros", () => {
    const f = summarizeLandingSessions([]);
    for (const s of f.steps) expect(s).toMatchObject({ raw: 0, human: 0 });
    expect(f.sessions).toBe(0);
    expect(f.botReasons).toEqual({});
  });
});

describe("gateVerdict · thresholds display logic", () => {
  test("no measurable data → no-data", () => {
    const results = evaluateFunnelGates({
      delivered: 0,
      humanPageVisits: 0,
      humanEngaged: 0,
      paid: 0,
    });
    expect(gateVerdict(0, results)).toBe("no-data");
  });

  test("all gates passing → pass", () => {
    // 100 delivered → 10 visits (10% ≥ 5%) → 2 engaged (20% ≥ 8%) → 1 paid
    // (10% ≥ 0.5%).
    const results = evaluateFunnelGates({
      delivered: 100,
      humanPageVisits: 10,
      humanEngaged: 2,
      paid: 1,
    });
    expect(results.every((r) => r.pass)).toBe(true);
    expect(gateVerdict(500, results)).toBe("pass");
  });

  test("failing before the verdict window → fail-early", () => {
    // 1% email→page, fails the 5% gate.
    const results = evaluateFunnelGates({
      delivered: 1000,
      humanPageVisits: 10,
      humanEngaged: 2,
      paid: 1,
    });
    expect(gateVerdict(VERDICT_MIN_SENDS - 1, results)).toBe("fail-early");
  });

  test("failing at the verdict window → fallback", () => {
    const results = evaluateFunnelGates({
      delivered: 2500,
      humanPageVisits: 20,
      humanEngaged: 0,
      paid: 0,
    });
    expect(gateVerdict(VERDICT_MIN_SENDS, results)).toBe("fallback");
  });
});
