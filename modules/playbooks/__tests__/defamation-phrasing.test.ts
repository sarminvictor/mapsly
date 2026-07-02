// WP7-3 · defamation-phrasing constitution · registry-wide invariant.
//
// The product promise is "NEVER an unverified accusation". Two layers ship on a
// SHARED artifact (the Proof Pack one-pager, the /s/[token] share page, the CSV
// `pitchAngle` column), so both must pass the exposure-framing constitution:
//
//   1. the STATIC copy of every registered signal (its `label` + `pitchAngle`),
//      authored constants that render regardless of any detector;
//   2. the DYNAMIC copy a detector emits (`explanation` + each evidence
//      `detail`) when it actually fires.
//
// This test walks EVERY signal of EVERY playbook and asserts neither layer uses
// a banned legal absolute ("violates" / "illegal" / "non-compliant" / …). A new
// detector whose headline copy asserts a violation can therefore never merge —
// the guard is mechanical, not a review checklist.

import { describe, expect, test } from "vitest";

import {
  assertExposurePhrasing,
  assertSignalCopy,
  BANNED_ABSOLUTE_PATTERNS,
} from "../copy-lint";
import { ALL_PLAYBOOKS } from "../registry";
import type { EvidenceBundle, PlaybookSignal } from "../types";

/** Every registered signal, flattened across all playbooks (deduped by key). */
const ALL_SIGNALS: PlaybookSignal[] = (() => {
  const seen = new Map<string, PlaybookSignal>();
  for (const pb of ALL_PLAYBOOKS) {
    for (const s of pb.signals) if (!seen.has(s.key)) seen.set(s.key, s);
  }
  return [...seen.values()];
})();

/** Assert a string carries no banned legal absolute (mirrors the guard, but
 *  returns a boolean for the sweep). */
function isClean(text: string): boolean {
  return !BANNED_ABSOLUTE_PATTERNS.some((re) => re.test(text));
}

describe("WP7-3 · every playbook signal's STATIC copy is exposure-framed", () => {
  test("there are signals to lint (guards against a silent empty registry)", () => {
    expect(ALL_SIGNALS.length).toBeGreaterThanOrEqual(15);
  });

  test.each(ALL_SIGNALS.map((s) => [s.key, s] as const))(
    "signal %s · label + pitchAngle pass the constitution",
    (_key, signal) => {
      expect(() => assertSignalCopy(signal)).not.toThrow();
    },
  );

  test("no static label or pitchAngle uses a banned absolute", () => {
    const offenders: string[] = [];
    for (const s of ALL_SIGNALS) {
      if (!isClean(s.label)) offenders.push(`${s.key}.label: ${s.label}`);
      if (!isClean(s.pitchAngle))
        offenders.push(`${s.key}.pitchAngle: ${s.pitchAngle}`);
    }
    expect(offenders).toEqual([]);
  });
});

// ── A bundle engineered to make EVERY detector return something ──────────────
// Detectors gate on category + enrichment presence + false-positive guards. We
// can't tailor one bundle to fire all 18 heterogeneous detectors, so instead we
// run each detector against a permissive bundle matching its OWN category and
// assert that WHATEVER it emits (when it fires) is exposure-framed. A detector
// that returns null for this generic bundle simply contributes nothing to lint
// here — its static copy is already covered above, and its dynamic copy is
// guarded at construction via `assertExposurePhrasing`.

/** A maximally-tripping evidence bundle for a signal's own category. `tech` is
 *  the real flat `{ name, category }[]` shape — rich enough that tracker /
 *  booking detectors trip; the failing Lighthouse set trips ADA-style ones. */
function firingBundle(categorySlug: string): EvidenceBundle {
  return {
    business: {
      id: "b1",
      slug: "acme",
      categorySlugs: [categorySlug],
      website: "https://acme.example",
      services: [{ name: "Botox" }],
    },
    tech: [
      { name: "Google Analytics", category: "analytics" },
      { name: "Meta Pixel", category: "ad-pixel" },
      { name: "Calendly", category: "booking" },
    ],
    lighthouseAudits: {
      "color-contrast": { score: 0, failingNodes: 14 },
      "image-alt": { score: 0, failingNodes: 9 },
      label: { score: 0, failingNodes: 5 },
    },
    reviews: [],
  };
}

describe("WP7-3 · every detector's DYNAMIC copy (when it fires) is exposure-framed", () => {
  for (const pb of ALL_PLAYBOOKS) {
    const category = pb.categorySlugs[0];
    for (const signal of pb.signals) {
      test(`${pb.id}/${signal.key} · emitted explanation + evidence are clean`, () => {
        let verdict = null;
        try {
          verdict = signal.detect(firingBundle(category));
        } catch {
          // A detector may throw ExposurePhrasingError itself if its copy is
          // dirty — that IS the guard working. Surface it as a failure.
          throw new Error(
            `${signal.key} threw while detecting — its copy likely tripped the constitution`,
          );
        }
        if (!verdict) return; // didn't fire for this generic bundle — nothing to lint
        expect(() => assertExposurePhrasing(verdict.explanation)).not.toThrow();
        for (const ev of verdict.evidence) {
          expect(isClean(ev.label)).toBe(true);
          expect(isClean(ev.detail)).toBe(true);
        }
      });
    }
  }
});
