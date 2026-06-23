/**
 * Playbook driver · invariant tests
 *
 * The driver is the single chokepoint enforcing the safety invariants, so each
 * gate gets an explicit test: missing-enrichment → null, guard-trip → null,
 * detector-throw → null, evidence-mandatory (throws in dev), maxConfidence cap,
 * and runPlaybook's per-signal result rows with notCheckedReason.
 */

import { describe, expect, test } from "vitest";
import { runPlaybook, runSignal } from "../driver";
import type {
  CellPlaybook,
  EvidenceBundle,
  PlaybookSignal,
  SignalVerdict,
} from "../types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function bundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    business: {
      id: "b1",
      slug: "acme",
      categorySlugs: ["med-spa"],
      website: "https://acme.example",
      services: [],
    },
    tech: [],
    lighthouseAudits: {},
    reviews: [],
    ...overrides,
  };
}

const goodVerdict: SignalVerdict = {
  value: "high",
  confidence: "high",
  evidence: [{ kind: "failing_audit", label: "x", detail: "y", weight: 1 }],
  explanation: "A potential exposure worth checking.",
  corroborationCount: 2,
};

function makeSignal(overrides: Partial<PlaybookSignal> = {}): PlaybookSignal {
  return {
    key: "test-signal",
    label: "Test",
    group: "test",
    requiresEnrichments: [],
    maxConfidence: "high",
    pitchAngle: "p",
    regulationRefs: [],
    falsePositiveGuards: [],
    detect: () => goodVerdict,
    ...overrides,
  };
}

// ─── requiresEnrichments ─────────────────────────────────────────────────────

describe("runSignal · requiresEnrichments", () => {
  test("null when a required enrichment is missing (tech === null)", () => {
    const sig = makeSignal({ requiresEnrichments: ["tech"] });
    expect(runSignal(sig, bundle({ tech: null }))).toBeNull();
  });

  test("null when lighthouseAudits is null", () => {
    const sig = makeSignal({ requiresEnrichments: ["lighthouseAudits"] });
    expect(runSignal(sig, bundle({ lighthouseAudits: null }))).toBeNull();
  });

  test("runs when the required enrichment is present (empty array counts)", () => {
    const sig = makeSignal({ requiresEnrichments: ["tech"] });
    expect(runSignal(sig, bundle({ tech: [] }))).not.toBeNull();
  });
});

// ─── falsePositiveGuards ─────────────────────────────────────────────────────

describe("runSignal · falsePositiveGuards", () => {
  test("null when a guard trips", () => {
    const sig = makeSignal({
      falsePositiveGuards: [() => ({ tripped: true, reason: "boom" })],
    });
    expect(runSignal(sig, bundle())).toBeNull();
  });

  test("runs when no guard trips", () => {
    const sig = makeSignal({
      falsePositiveGuards: [() => ({ tripped: false, reason: "" })],
    });
    expect(runSignal(sig, bundle())).not.toBeNull();
  });

  test("null when a guard itself throws (fail-closed)", () => {
    const sig = makeSignal({
      falsePositiveGuards: [
        () => {
          throw new Error("guard exploded");
        },
      ],
    });
    expect(runSignal(sig, bundle())).toBeNull();
  });
});

// ─── try/catch around detect ─────────────────────────────────────────────────

describe("runSignal · detector throw → null", () => {
  test("null when detect throws", () => {
    const sig = makeSignal({
      detect: () => {
        throw new Error("detector exploded");
      },
    });
    expect(runSignal(sig, bundle())).toBeNull();
  });

  test("null when detect returns null (no finding)", () => {
    const sig = makeSignal({ detect: () => null });
    expect(runSignal(sig, bundle())).toBeNull();
  });
});

// ─── evidence-mandatory ──────────────────────────────────────────────────────

describe("runSignal · evidence-mandatory", () => {
  test("throws in dev when a non-null verdict carries no evidence", () => {
    const sig = makeSignal({
      detect: () => ({ ...goodVerdict, evidence: [] }),
    });
    expect(() => runSignal(sig, bundle())).toThrow(/evidence-mandatory/);
  });
});

// ─── maxConfidence cap ───────────────────────────────────────────────────────

describe("runSignal · maxConfidence cap", () => {
  test("caps a high detector verdict to the signal's medium ceiling", () => {
    const sig = makeSignal({ maxConfidence: "medium" });
    const v = runSignal(sig, bundle());
    expect(v?.confidence).toBe("medium");
  });

  test("does not raise a low verdict to the ceiling", () => {
    const sig = makeSignal({
      maxConfidence: "high",
      detect: () => ({ ...goodVerdict, confidence: "low" }),
    });
    expect(runSignal(sig, bundle())?.confidence).toBe("low");
  });
});

// ─── runPlaybook ─────────────────────────────────────────────────────────────

describe("runPlaybook", () => {
  test("returns a row per signal with verdict or null+reason", () => {
    const playbook: CellPlaybook = {
      id: "pb",
      version: "1.0.0",
      categorySlugs: ["med-spa"],
      regulations: [],
      signals: [
        makeSignal({ key: "ok" }),
        makeSignal({ key: "needs-tech", requiresEnrichments: ["tech"] }),
        makeSignal({
          key: "guarded",
          falsePositiveGuards: [
            () => ({ tripped: true, reason: "out-of-scope" }),
          ],
        }),
      ],
    };

    const results = runPlaybook(playbook, bundle({ tech: null }));
    expect(results).toHaveLength(3);

    const byKey = Object.fromEntries(results.map((r) => [r.signalKey, r]));
    expect(byKey.ok.verdict).not.toBeNull();
    expect(byKey["needs-tech"].verdict).toBeNull();
    expect(byKey["needs-tech"].notCheckedReason).toBe(
      "missing-enrichment:tech",
    );
    expect(byKey.guarded.verdict).toBeNull();
    expect(byKey.guarded.notCheckedReason).toBe("guard-tripped:out-of-scope");
  });

  test("null with no finding is reported as no-finding (never clean)", () => {
    const playbook: CellPlaybook = {
      id: "pb",
      version: "1.0.0",
      categorySlugs: [],
      regulations: [],
      signals: [makeSignal({ key: "nf", detect: () => null })],
    };
    const [row] = runPlaybook(playbook, bundle());
    expect(row.verdict).toBeNull();
    expect(row.notCheckedReason).toBe("no-finding");
  });
});
