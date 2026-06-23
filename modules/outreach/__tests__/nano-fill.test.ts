// Phase 8 · the gpt-5.4-nano fluency pass may only REPHRASE grounded lines.
// factCheck rejects any rewrite that introduces a number or claim the skeleton
// lacked; on rejection or any nano error, fluencyRewrite falls back to the
// skeleton verbatim. Never emits an unfilled token. Cost-counted.

import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock the AI client so no network is hit and we control nano output / errors.
const aiMock = vi.hoisted(() => ({ callOpenAi: vi.fn() }));
vi.mock("@/services/ai/client", () => aiMock);

import { factCheck, fluencyRewrite, NANO_FILL_MODEL } from "../nano-fill";
import {
  buildFirstTouch,
  type FirstTouch,
  type TouchSignals,
} from "../first-touch";

beforeEach(() => {
  vi.clearAllMocks();
});

const signals: TouchSignals = {
  businessName: "Glow Spa",
  city: "Miami",
  unansweredNegative: 3,
};

/** A real grounded skeleton (DM channel → no footer) to feed the rewriter. */
function skeleton(): FirstTouch {
  return buildFirstTouch(signals, { sellingWhat: "marketing", channel: "dm" });
}

describe("factCheck", () => {
  test("accepts a faithful rephrase (no new facts)", () => {
    const original =
      "You have 3 unanswered negative reviews — the kind patients read before they call.";
    const rewrite =
      "I noticed 3 negative reviews you haven't replied to yet — exactly what patients see before calling.";
    expect(factCheck(original, rewrite, "Glow Spa")).toBeNull();
  });

  test("rejects a rewrite that introduces a NEW number", () => {
    const original = "You have 3 unanswered negative reviews worth a look.";
    const rewrite =
      "You have 3 unanswered reviews and could win 50% more bookings.";
    // Both "50" is new AND "%" is a fabrication trigger; either rejects it.
    expect(factCheck(original, rewrite, "Glow Spa")).not.toBeNull();
  });

  test("rejects a rewrite that introduces a fabricated claim", () => {
    const original = "There's no online booking on your site for patients.";
    const rewrite =
      "There's no online booking — we guarantee we can fix that and add online booking.";
    expect(factCheck(original, rewrite, "Glow Spa")).toBe("added_claim");
  });

  test("rejects a rewrite that drops the business name", () => {
    const original = "Want a quick rundown of what I found for Glow Spa?";
    const rewrite = "Want a quick rundown of what I found for your business?";
    expect(factCheck(original, rewrite, "Glow Spa")).toBe(
      "missing_business_name",
    );
  });

  test("rejects an empty rewrite", () => {
    expect(factCheck("anything with content", "   ")).toBe("empty_output");
  });

  test("rejects a rewrite carrying an unfilled merge token", () => {
    expect(factCheck("Hi there", "Hi {{businessName}}")).toBe("unfilled_token");
  });
});

describe("fluencyRewrite", () => {
  test("uses the nano rewrite when it passes the fact-check", async () => {
    const sk = skeleton();
    aiMock.callOpenAi.mockResolvedValue({
      text: "Hi — I work with marketing businesses around Miami. I noticed 3 negative reviews you haven't replied to yet, which is exactly what patients read before calling. Want a quick rundown of what I found for Glow Spa?",
      costUsd: 0.00002,
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 60 },
      model: NANO_FILL_MODEL,
    });

    const res = await fluencyRewrite(sk, signals);

    expect(res.rewritten).toBe(true);
    expect(res.fallbackReason).toBeUndefined();
    expect(res.body).toContain("3 negative reviews");
    expect(res.body).toContain("Glow Spa");
    expect(res.costUsd).toBeGreaterThan(0);
    expect(aiMock.callOpenAi).toHaveBeenCalledTimes(1);
    // Model must be gpt-5.4-nano per task constraint.
    expect(aiMock.callOpenAi.mock.calls[0][0].model).toBe("gpt-5.4-nano");
  });

  test("FALLS BACK to the skeleton when the rewrite adds a claim", async () => {
    const sk = skeleton();
    aiMock.callOpenAi.mockResolvedValue({
      // Introduces a fabricated guarantee + a 50% stat not in the skeleton.
      text: "Hi Glow Spa — you have 3 unanswered reviews and we guarantee 50% more patients if you reply. Want a rundown?",
      costUsd: 0.00002,
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 40 },
      model: NANO_FILL_MODEL,
    });

    const res = await fluencyRewrite(sk, signals);

    expect(res.rewritten).toBe(false);
    expect(
      res.fallbackReason === "added_claim" ||
        res.fallbackReason === "added_number",
    ).toBe(true);
    // The body is the skeleton VERBATIM (the honest, grounded one).
    expect(res.body).toBe(sk.body);
    // We still bill the call that was made.
    expect(res.costUsd).toBeGreaterThan(0);
  });

  test("FALLS BACK to the skeleton on any nano error", async () => {
    const sk = skeleton();
    aiMock.callOpenAi.mockRejectedValue(new Error("[ai] OpenAI HTTP 503"));

    const res = await fluencyRewrite(sk, signals);

    expect(res.rewritten).toBe(false);
    expect(res.fallbackReason).toBe("nano_error");
    expect(res.body).toBe(sk.body);
    expect(res.costUsd).toBe(0);
  });

  test("preserves the CAN-SPAM footer verbatim through a rewrite (email skeleton)", async () => {
    const emailSk = buildFirstTouch(signals, {
      sellingWhat: "marketing",
      channel: "email",
      mailingAddress: "1 Main St, Miami FL 33131",
      unsubscribeUrl: "https://mapsly.ai/u/abc",
    });
    aiMock.callOpenAi.mockResolvedValue({
      text: "Hi — I work with marketing businesses around Miami. I noticed 3 negative reviews you haven't replied to yet. Want a quick rundown of what I found for Glow Spa?",
      costUsd: 0.00002,
      finishReason: "stop",
      usage: { inputTokens: 120, outputTokens: 55 },
      model: NANO_FILL_MODEL,
    });

    const res = await fluencyRewrite(emailSk, signals);

    expect(res.rewritten).toBe(true);
    // Footer (postal address + unsubscribe) survives untouched.
    expect(res.body).toContain("1 Main St, Miami FL 33131");
    expect(res.body).toContain("Unsubscribe: https://mapsly.ai/u/abc");
    // nano was NOT shown the footer (so no postal digits leaked into the prompt).
    const promptShown = aiMock.callOpenAi.mock.calls[0][0].prompt as string;
    expect(promptShown).not.toContain("1 Main St");
  });

  test("never emits an unfilled token in the chosen body", async () => {
    const sk = skeleton();
    aiMock.callOpenAi.mockResolvedValue({
      text: "Hi Glow Spa — I noticed 3 unanswered reviews. Want a rundown of what I found for Glow Spa?",
      costUsd: 0.00001,
      finishReason: "stop",
      usage: { inputTokens: 90, outputTokens: 30 },
      model: NANO_FILL_MODEL,
    });
    const res = await fluencyRewrite(sk, signals);
    expect(res.body).not.toMatch(/\{\{[^}]+\}\}/);
  });
});
