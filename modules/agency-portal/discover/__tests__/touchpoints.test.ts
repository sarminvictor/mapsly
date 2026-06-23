// Phase 9 · pure OutreachDraft → TouchpointDraftData mapping for the agency
// Touchpoints view. whyJson is an opaque Json column, so parseWhyJson must be
// defensive (any field may be missing or the wrong type).

import { describe, expect, test } from "vitest";
import { parseWhyJson, toTouchpointDraft, type RawDraft } from "../touchpoints";

describe("parseWhyJson", () => {
  test("extracts why + usedSignals from a well-formed blob", () => {
    const r = parseWhyJson({
      why: ["Unanswered negatives", "Declining reviews"],
      usedSignals: ["unansweredNegative", "reviewLifecycle"],
      droppedTokens: ["{city}"],
    });
    expect(r.why).toEqual(["Unanswered negatives", "Declining reviews"]);
    expect(r.usedSignals).toEqual(["unansweredNegative", "reviewLifecycle"]);
  });

  test("null / non-object → empty arrays", () => {
    expect(parseWhyJson(null)).toEqual({ why: [], usedSignals: [] });
    expect(parseWhyJson("nope")).toEqual({ why: [], usedSignals: [] });
    expect(parseWhyJson(42)).toEqual({ why: [], usedSignals: [] });
  });

  test("filters out non-string array members + missing fields", () => {
    const r = parseWhyJson({ why: ["a", 1, null, "b"], usedSignals: 7 });
    expect(r.why).toEqual(["a", "b"]);
    expect(r.usedSignals).toEqual([]);
  });
});

describe("toTouchpointDraft", () => {
  test("maps a raw draft into the client-safe shape", () => {
    const raw: RawDraft = {
      id: "d1",
      businessName: "Glow Spa",
      channel: "email",
      subject: "A quick note about your reviews",
      body: "Hi — noticed 3 unanswered 1-star reviews...",
      predictedTier: "high",
      whyJson: {
        why: ["Unanswered negatives"],
        usedSignals: ["unansweredNegative"],
      },
      createdAt: new Date("2026-06-22T12:00:00.000Z"),
    };
    const d = toTouchpointDraft(raw);
    expect(d.id).toBe("d1");
    expect(d.businessName).toBe("Glow Spa");
    expect(d.channel).toBe("email");
    expect(d.subject).toBe("A quick note about your reviews");
    expect(d.predictedTier).toBe("high");
    expect(d.why).toEqual(["Unanswered negatives"]);
    expect(d.usedSignals).toEqual(["unansweredNegative"]);
    expect(d.createdAt).toBe("2026-06-22T12:00:00.000Z");
  });

  test("tolerates null subject / null whyJson", () => {
    const raw: RawDraft = {
      id: "d2",
      businessName: null,
      channel: "dm",
      subject: null,
      body: "body only",
      predictedTier: null,
      whyJson: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const d = toTouchpointDraft(raw);
    expect(d.subject).toBeNull();
    expect(d.businessName).toBeNull();
    expect(d.why).toEqual([]);
    expect(d.usedSignals).toEqual([]);
  });
});
