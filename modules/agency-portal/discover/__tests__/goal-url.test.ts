import { describe, expect, it } from "vitest";

import { buildResumeGoalG, decodeGoal, encodeGoal } from "../goal-url";
import { loadGoalFrom, type GoalState } from "../flow-types";
import { templateByKey } from "../goal-templates";

// The bug this guards (the "settings do nothing" report): encoding the goal as
// only `goal=<base>&sig=<on-keys>` dropped every per-signal tune / conds /
// match, so a setting click reverted on the next render and the tune never
// reached eval. encodeGoal/decodeGoal must be LOSSLESS for the behavior fields.

function sampleGoal(): GoalState {
  return {
    base: "website",
    name: "My custom goal — über v2", // em-dash + non-ASCII (utf-8 base64 path)
    customized: true,
    filters: [
      { key: "operating_business", on: true, why: "x" },
      {
        key: "diy_platform",
        on: true,
        why: "x",
        tune: { kind: "platform", values: ["wix", "godaddy"] },
      },
      {
        key: "overdue_redesign",
        on: true,
        why: "x",
        match: "any",
        conds: { "0": true, "1": false },
        tune: { kind: "strictness", level: "strict" },
      },
      { key: "has_website", on: false, why: "x" },
    ],
  };
}

describe("goal-url lossless round-trip", () => {
  it("preserves on / match / conds / tune / customized / name through encode→decode", () => {
    const goal = sampleGoal();
    const { goal: gk, sig, g } = encodeGoal(goal);
    const back = decodeGoal(gk, sig, g);

    expect(back).not.toBeNull();
    expect(back!.base).toBe("website");
    expect(back!.name).toBe("My custom goal — über v2"); // utf-8 survives
    expect(back!.customized).toBe(true);

    // Behavior fields preserved exactly (the derived `why` is re-derived, not asserted).
    const byKey = new Map(back!.filters.map((f) => [f.key, f]));
    expect(byKey.get("operating_business")!.on).toBe(true);
    expect(byKey.get("has_website")!.on).toBe(false);

    expect(byKey.get("diy_platform")!.tune).toEqual({
      kind: "platform",
      values: ["wix", "godaddy"],
    });

    const rd = byKey.get("overdue_redesign")!;
    expect(rd.match).toBe("any");
    expect(rd.conds).toEqual({ "0": true, "1": false });
    expect(rd.tune).toEqual({ kind: "strictness", level: "strict" });
  });

  it("keeps the on-set in the readable sig param (legacy/shareable links)", () => {
    const { sig } = encodeGoal(sampleGoal());
    const on = sig.split(",");
    expect(on).toContain("diy_platform");
    expect(on).not.toContain("has_website"); // off → not in sig
  });

  it("the lossless g payload wins over a stale goalKey/sig", () => {
    const { g } = encodeGoal(sampleGoal());
    const back = decodeGoal("nonexistent", "", g);
    expect(back).not.toBeNull();
    expect(back!.base).toBe("website");
    expect(back!.filters.find((f) => f.key === "overdue_redesign")!.match).toBe(
      "any",
    );
  });

  it("falls back to template+sig for a legacy link with no g", () => {
    const base = loadGoalFrom(templateByKey("website")!);
    const onKeys = base.filters.filter((f) => f.on).map((f) => f.key);
    // Turn the first default-on signal OFF via the sig param.
    const reduced = onKeys.slice(1).join(",");
    const back = decodeGoal("website", reduced, null);

    expect(back).not.toBeNull();
    expect(back!.base).toBe("website");
    const offKey = onKeys[0]!;
    expect(back!.filters.find((f) => f.key === offKey)!.on).toBe(false);
    expect(back!.customized).toBe(true); // differs from default → customized
  });

  it("a legacy link with the exact default on-set is NOT customized", () => {
    const base = loadGoalFrom(templateByKey("website")!);
    const onKeys = base.filters
      .filter((f) => f.on)
      .map((f) => f.key)
      .join(",");
    const back = decodeGoal("website", onKeys, null);
    expect(back!.customized).toBe(false);
  });

  it("malformed g falls back to the legacy decode", () => {
    const back = decodeGoal("website", "", "!!!not-valid-base64!!!");
    expect(back).not.toBeNull();
    expect(back!.base).toBe("website");
  });

  it("returns null when nothing resolves", () => {
    expect(decodeGoal(null, null, null)).toBeNull();
    expect(decodeGoal("nope-not-a-template", "", null)).toBeNull();
  });
});

describe("buildResumeGoalG (research resume)", () => {
  it("rebuilds a g that decodeGoal reads back into a functional goal", () => {
    const g = buildResumeGoalG("website", "Website redesign", [
      { key: "has_website" },
      { key: "overdue_redesign", match: "all" },
    ]);
    const goal = decodeGoal(null, null, g);
    expect(goal).not.toBeNull();
    expect(goal!.base).toBe("website");
    expect(goal!.name).toBe("Website redesign");
    // Persisted signals come back on:true; the second keeps its combine mode.
    const keys = goal!.filters.map((f) => f.key);
    expect(keys).toContain("has_website");
    expect(keys).toContain("overdue_redesign");
    expect(goal!.filters.every((f) => f.on)).toBe(true);
  });

  it("falls back to the template title when the name wasn't persisted", () => {
    const g = buildResumeGoalG("website", null, [{ key: "has_website" }]);
    const goal = decodeGoal(null, null, g);
    expect(goal!.name).toBe(templateByKey("website")?.title ?? "Custom");
  });

  it("empty base + no name → a decodable 'Custom' goal", () => {
    const g = buildResumeGoalG(null, null, [{ key: "has_website" }]);
    const goal = decodeGoal(null, null, g);
    expect(goal).not.toBeNull();
    expect(goal!.name).toBe("Custom");
  });
});
