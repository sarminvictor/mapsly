/**
 * Cell-Playbook detection framework · type definitions (Phase 7)
 *
 * The expert/compliance signal layer. A "playbook" bundles the regulations
 * and detectors relevant to one industry cell (e.g. med-spa, dental). Each
 * detector is a PURE function: a plain {@link EvidenceBundle} goes in, a
 * {@link SignalVerdict} (or null) comes out. No Prisma import, no AI calls,
 * no I/O — so the whole layer is deterministically testable and safe to run
 * anywhere (cron, request path, unit test).
 *
 * Product promise · "NEVER an unverified accusation":
 *   - deterministic-first   — detectors are pure rules over hard artifacts
 *   - evidence-mandatory    — a non-null verdict ALWAYS carries ≥1 evidence item
 *   - exposure-framed       — copy says "potential exposure", never "violation"
 *   - null = "not checked"  — null is "we did not check", NEVER "clean"
 *
 * See:
 *   - .claude/rules/signal-engineering.md — anatomy of a signal
 *   - .claude/rules/copy-voice.md         — exposure framing, banned absolutes
 *   - modules/playbooks/confidence.ts     — tierFromEvidence / capConfidence
 *   - modules/playbooks/driver.ts         — runSignal / runPlaybook (the runner)
 *   - modules/playbooks/copy-lint.ts      — assertExposurePhrasing
 */

/**
 * How sure we are about a verdict. Drives UI badge + whether the verdict is
 * surfaceable as a pitch wedge. `high` is reserved for corroborated hard
 * artifacts; `low` is a soft hint that must never stand alone as an accusation.
 */
export type Confidence = "high" | "medium" | "low";

/**
 * The kind of a single piece of evidence. The ordering here also encodes
 * "hardness": detected_script, failing_audit, license_lookup, dom_fingerprint
 * are HARD artifacts (machine-verifiable); the rest are softer corroboration.
 */
export type EvidenceKind =
  | "review_quote"
  | "detected_script"
  | "failing_audit"
  | "dom_fingerprint"
  | "license_lookup"
  | "ad_creative"
  | "cell_percentile"
  | "attribute"
  | "nano_reading";

/**
 * One atomic piece of evidence backing a verdict. Every non-null verdict
 * MUST carry at least one of these (evidence-mandatory invariant). The
 * `weight` is a 0–1 hint of how load-bearing this item is for the verdict.
 */
export interface EvidenceItem {
  kind: EvidenceKind;
  /** Short human label, e.g. "Color contrast audit" */
  label: string;
  /** The concrete observation, e.g. "12 nodes below 4.5:1 contrast" */
  detail: string;
  /** Optional deep-link to the source artifact (audit report, license record) */
  sourceUrl?: string;
  /** 0–1 relative weight of this item toward the verdict */
  weight: number;
}

/**
 * The output of a detector. `value` is the headline reading (a risk level
 * string, a boolean presence flag, or a number). `explanation` is the
 * exposure-framed sentence shown to the user — it MUST pass
 * {@link import("./copy-lint").assertExposurePhrasing}.
 */
export interface SignalVerdict {
  value: number | boolean | string;
  confidence: Confidence;
  evidence: EvidenceItem[];
  /** Exposure-framed; no banned absolutes (see copy-lint.ts) */
  explanation: string;
  /**
   * How many independent sources corroborate the verdict. Feeds the
   * confidence tiering (≥2 independent kinds is required for `high`).
   */
  corroborationCount: number;
}

/**
 * A guard that can short-circuit a detector to "not checked". `tripped: true`
 * means the detector must NOT emit a verdict (false-positive protection).
 */
export type FalsePositiveGuard = (ev: EvidenceBundle) => {
  tripped: boolean;
  reason: string;
};

/**
 * The plain, prisma-free shape a detector reads. The cron/snapshot layer is
 * responsible for hydrating this from the DB; detectors only ever see this
 * inert object. Any field that is `null` means "this enrichment was not run"
 * — detectors gate on it via {@link PlaybookSignal.requiresEnrichments}.
 */
export interface EvidenceBundle {
  business: {
    id: string;
    slug: string;
    /** Category slugs the business belongs to (lowercased) */
    categorySlugs: string[];
    website: string | null;
    /** Named services the business offers (e.g. "Botox", "Teeth whitening") */
    services: { name: string }[];
  };
  /**
   * Detected third-party tech (booking tools, pixels, analytics). `null` when
   * the tech-fingerprint enrichment has not run for this business.
   */
  tech: { name: string; category: string }[] | null;
  /**
   * Lighthouse audit results keyed by audit id (e.g. "color-contrast").
   * `null` when the Lighthouse enrichment has not run.
   */
  lighthouseAudits: Record<
    string,
    { score: number | null; failingNodes?: number }
  > | null;
  /** Recent reviews (always present; may be an empty array) */
  reviews: { text: string; stars: number; postedAt: Date }[];
}

/**
 * Names of the enrichments a bundle may carry. A detector lists the ones it
 * needs in {@link PlaybookSignal.requiresEnrichments}; the driver returns null
 * ("not checked") when any required enrichment is missing on the bundle.
 */
export type EnrichmentKey = "tech" | "lighthouseAudits" | "reviews";

/**
 * One detector inside a playbook. `detect` is the pure rule; everything else
 * is metadata the driver and the UI consume.
 */
export interface PlaybookSignal {
  key: string;
  label: string;
  /** Grouping bucket for the UI (e.g. "accessibility", "privacy") */
  group: string;
  /** Enrichments that must be present (non-null) for this detector to run */
  requiresEnrichments: EnrichmentKey[];
  /** Hard ceiling on the confidence this detector may emit */
  maxConfidence: Confidence;
  /** One-line agency pitch angle, e.g. "ADA web-accessibility exposure" */
  pitchAngle: string;
  /** Regulation references / notes (may flag CONTESTED status) */
  regulationRefs: string[];
  /** Guards that short-circuit to "not checked" when tripped */
  falsePositiveGuards: FalsePositiveGuard[];
  /** The pure detector. Returns null when there is nothing to report. */
  detect: (ev: EvidenceBundle) => SignalVerdict | null;
}

/**
 * A regulation referenced by a playbook. `contested` flags rules that are
 * legally unsettled (e.g. HHS tracking guidance post AHA v. HHS) so copy can
 * hedge appropriately.
 */
export interface PlaybookRegulation {
  name: string;
  scope: string;
  summary: string;
  citation: string;
  contested?: boolean;
}

/**
 * A full playbook for one or more industry cells.
 */
export interface CellPlaybook {
  id: string;
  version: string;
  categorySlugs: string[];
  regulations: PlaybookRegulation[];
  signals: PlaybookSignal[];
}
