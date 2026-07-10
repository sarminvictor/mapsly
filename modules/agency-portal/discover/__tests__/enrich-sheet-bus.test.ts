// Pure scope-default resolution for the EnrichMoreSheet (2026-07-10 · the
// phantom "Selected (8)" fix). The opener NAMES its intent; a stale row
// selection can no longer silently drive the toolbar run.

import { describe, expect, test } from "vitest";

import {
  resolveDefaultScope,
  enrichTypesForDomainKey,
} from "../enrich-sheet-bus";

describe("resolveDefaultScope", () => {
  test("toolbar (visible) opens on Visible regardless of a stale selection", () => {
    // THE fix: the toolbar passes "visible"; even with 8 stale-selected leads
    // present, the sheet opens on Visible, never the phantom Selected.
    expect(resolveDefaultScope("visible", 8, 118)).toBe("visible");
    expect(resolveDefaultScope("visible", 0, 118)).toBe("visible");
  });

  test("bulk bar (selected) opens on Selected when a live selection exists", () => {
    expect(resolveDefaultScope("selected", 8, 118)).toBe("selected");
  });

  test("named scope with no ids falls back sensibly, never an empty scope", () => {
    // "selected" but nothing selected → visible (or all if the view is empty).
    expect(resolveDefaultScope("selected", 0, 118)).toBe("visible");
    expect(resolveDefaultScope("selected", 0, 0)).toBe("all");
    // "visible" but no visible ids → all.
    expect(resolveDefaultScope("visible", 5, 0)).toBe("all");
  });

  test("no opener intent → P3 rule: selection wins, else whole research (never visible)", () => {
    // A single-lead / legacy path with a real selection → selected.
    expect(resolveDefaultScope(undefined, 1, 118)).toBe("selected");
    // No selection → WHOLE research, NOT the visible window (the dental-rerun
    // "scoped 28 not 122" guard — visible is never an implicit default).
    expect(resolveDefaultScope(undefined, 0, 118)).toBe("all");
  });

  test('explicit "all" always opens on Whole research', () => {
    expect(resolveDefaultScope("all", 8, 118)).toBe("all");
  });
});

// Guard the existing pure mapping stays intact alongside the new helper.
describe("enrichTypesForDomainKey", () => {
  test("ai door pulls both ai_research + services; unknown → []", () => {
    expect(enrichTypesForDomainKey("ai").sort()).toEqual([
      "ai_research",
      "services",
    ]);
    expect(enrichTypesForDomainKey("speed")).toEqual(["lighthouse"]);
    expect(enrichTypesForDomainKey("nope")).toEqual([]);
  });
});
