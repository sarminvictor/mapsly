// touch-gen-helpers · pure, client-safe helpers shared by GenerateTouchesOverlay,
// GenerateTouchpointsPanel and TouchpointsTab. Kept framework-free so the logic
// (storage keys · skip-summary lines · copy-email text · subject-toggle
// persistence) is unit-testable without a DOM/React harness, per
// `.claude/rules/testing.md` (test invariants, not rendering).

// ── B1 · "What are you selling?" storage keys ────────────────────────────────
//
// The pitch used to persist under ONE global key, so a med-spa pitch bled into
// the next research (an acupuncture hunt). We now key the pitch PER RESEARCH
// (by discoveryId) and keep the global key only as a nice default for a
// brand-new research. The /touchpoints panel is cross-discovery, so it keeps
// using the global key directly (pass no discoveryId).

/** The one global last-used key (brand-new-research default + panel scope). */
export const SELLING_GLOBAL_KEY = "mapsly.touchgen.sellingWhat";

/** Per-research key so a pitch never bleeds across researches. */
export function sellingKeyFor(discoveryId: string | undefined): string {
  return discoveryId
    ? `${SELLING_GLOBAL_KEY}:${discoveryId}`
    : SELLING_GLOBAL_KEY;
}

/**
 * Resolve the pitch to prefill on open: prefer this research's own last value,
 * fall back to the global last-used only when the per-research one is empty
 * (a sensible default for a research you've never drafted from). `read` is the
 * storage getter (injected so this stays pure + testable).
 */
export function resolveSellingWhat(
  discoveryId: string | undefined,
  read: (key: string) => string | null,
): string {
  const perResearch = read(sellingKeyFor(discoveryId));
  if (perResearch && perResearch.trim()) return perResearch;
  if (discoveryId) {
    const global = read(SELLING_GLOBAL_KEY);
    if (global && global.trim()) return global;
  }
  return "";
}

// ── B7 · "Add business name to subject" toggle persistence ───────────────────

/** Persisted per surface; both overlay + panel default OFF (expert default). */
export const SUBJECT_NAME_KEY = "mapsly.touchgen.includeNameInSubject";

/** Storage value is "1" for on; anything else (incl. missing) is off. */
export function readSubjectNameToggle(
  read: (key: string) => string | null,
): boolean {
  return read(SUBJECT_NAME_KEY) === "1";
}

// ── B3 · skip-summary lines (the 6-of-8 fix) ─────────────────────────────────

/**
 * The structured skip counts the engine returns. AGENT A is adding a nested
 * `skips` object to GenerateTouchpointsResult; until it lands, the flat
 * `skipped*` fields carry the same numbers. `normalizeSkips` reads whichever is
 * present so this UI compiles + works across the hand-off. `error` is the
 * previously-silent gather-error skip (A13) — 0 when the engine hasn't landed.
 */
export interface SkipCounts {
  noAddress: number;
  sparse: number;
  error: number;
  alreadyDrafted: number;
}

/** Loosely-typed shape covering BOTH the new nested + legacy flat results. */
export interface SkippableResult {
  skips?: Partial<SkipCounts> | null;
  skippedNoAddress?: number;
  skippedSparse?: number;
  skippedError?: number;
  skippedExisting?: number;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Fold a result (nested `skips` preferred, flat fields as fallback) into totals. */
export function normalizeSkips(r: SkippableResult): SkipCounts {
  const s = r.skips ?? null;
  return {
    noAddress: num(s?.noAddress) || num(r.skippedNoAddress),
    sparse: num(s?.sparse) || num(r.skippedSparse),
    error: num(s?.error) || num(r.skippedError),
    alreadyDrafted: num(s?.alreadyDrafted) || num(r.skippedExisting),
  };
}

/** Sum two running skip totals (a chunked run accumulates across batches). */
export function addSkips(a: SkipCounts, b: SkipCounts): SkipCounts {
  return {
    noAddress: a.noAddress + b.noAddress,
    sparse: a.sparse + b.sparse,
    error: a.error + b.error,
    alreadyDrafted: a.alreadyDrafted + b.alreadyDrafted,
  };
}

export const EMPTY_SKIPS: SkipCounts = {
  noAddress: 0,
  sparse: 0,
  error: 0,
  alreadyDrafted: 0,
};

export interface GenerateSummary {
  /** Headline: "Drafted 6 · 2 skipped" or "Drafted 8" when nothing skipped. */
  headline: string;
  /** One line per non-zero skip reason (agency voice, non-alarming). */
  reasons: string[];
  /** True when every selected lead drafted — render a clean success line. */
  clean: boolean;
}

/**
 * B3 · the in-overlay result summary. `drafted` is the total generated across
 * the run; `skips` the accumulated skip counts. Only reasons with count > 0
 * appear. Sentence case, no emoji, no exclamation marks (agency voice).
 */
export function buildGenerateSummary(
  drafted: number,
  skips: SkipCounts,
): GenerateSummary {
  const skipped =
    skips.noAddress + skips.sparse + skips.error + skips.alreadyDrafted;
  const reasons: string[] = [];
  if (skips.sparse > 0)
    reasons.push(
      `${skips.sparse} skipped — no pain to pitch yet (enrich or pick other leads)`,
    );
  if (skips.error > 0)
    reasons.push(
      `${skips.error} skipped — couldn't read ${
        skips.error === 1 ? "this lead's" : "these leads'"
      } data`,
    );
  if (skips.alreadyDrafted > 0)
    reasons.push(
      `${skips.alreadyDrafted} already ${
        skips.alreadyDrafted === 1 ? "has" : "have"
      } a touch`,
    );
  if (skips.noAddress > 0)
    reasons.push(
      `${skips.noAddress} need a mailing address — set it in Settings → Profile`,
    );

  if (skipped === 0) {
    return {
      headline: `Drafted ${drafted} touch${drafted === 1 ? "" : "es"}`,
      reasons: [],
      clean: true,
    };
  }
  return {
    headline: `Drafted ${drafted} · ${skipped} skipped`,
    reasons,
    clean: false,
  };
}

// ── B6 · copy-email text (subject + body) ────────────────────────────────────

/**
 * The clipboard payload for "Copy email": a labeled subject line then the body,
 * ready to paste into an email client. Subject omitted when the channel has
 * none (dm/phone/social) — body-only.
 */
export function copyEmailText(
  subject: string | null | undefined,
  body: string,
): string {
  const s = subject?.trim();
  return s ? `Subject: ${s}\n\n${body}` : body;
}
