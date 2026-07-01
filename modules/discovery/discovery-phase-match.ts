// discovery-phase-match.ts · the "~N passing so-far" estimate for the Preview
// KPI card. Before enrichment, most signals can't be evaluated (they need
// Lighthouse / reviews / ads data that isn't collected yet) — so a definitive
// "matches your signals" count is impossible and showing a hard "0" is
// misleading. What we CAN evaluate at discovery is the handful of signals that
// read fields already on the Google/Maps listing (website presence, open
// status, phone). This maps those to a cheap Business WHERE fragment so we can
// count "businesses passing the signals we can already check" — a real,
// honest upper bound (labelled "~") that narrows to the exact count once
// enrichment runs.
//
// Keyed by REGISTRY signalKey (what preflightDiscoveryAction threads through as
// `signalKeys`, i.e. SIG_META[key].signalKey), NOT the SIG_META key. Only the
// signals whose discovery-time semantics are unambiguous are here; anything
// else (needs enrichment, or roadmap) contributes no predicate, so the estimate
// is an upper bound over the checkable signals — never a fabricated number.

import type { Prisma } from "@/lib/prisma";

/**
 * Registry signalKey → the Business predicate that evaluates it from
 * discovery-time listing data alone. Intentionally small: these are the only
 * signals whose meaning is fully known before any enrichment runs.
 */
const DISCOVERY_PHASE_PREDICATES: Record<string, Prisma.BusinessWhereInput> = {
  // has_website (Website redesign / weak-web goals): has a site to improve.
  has_website: { website: { not: null } },
  // open_status (Operating business): currently operating, not closed.
  open_status: { openStatus: "OPEN" },
  // open_now: active hours — same listing signal as open_status.
  open_now: { openStatus: "OPEN" },
  // phone_only: reachable by phone but has no website (needs one built).
  phone_only: { phone: { not: null }, website: null },
};

/** The registry signalKeys this module can evaluate at discovery time. */
export const DISCOVERY_PHASE_SIGNAL_KEYS = Object.keys(
  DISCOVERY_PHASE_PREDICATES,
);

/**
 * Build the AND-combined Business WHERE fragment for the discovery-evaluable
 * subset of the given active signalKeys. Returns `null` when NONE of the active
 * signals is discovery-evaluable — the caller then shows "—" ("computed after
 * enrichment") rather than a misleading count over an empty predicate set (an
 * empty predicate would match the whole cell and overstate the estimate).
 */
export function discoveryPhaseWhere(
  signalKeys: readonly string[],
): Prisma.BusinessWhereInput | null {
  const preds = signalKeys
    .map((k) => DISCOVERY_PHASE_PREDICATES[k])
    .filter((p): p is Prisma.BusinessWhereInput => p != null);
  if (preds.length === 0) return null;
  // AND them: a business "passes so far" only if it satisfies EVERY checkable
  // signal. `phone_only` sets `website: null` while `has_website` sets
  // `website: { not: null }` — those are mutually exclusive by design (a goal
  // that picks both would legitimately match nothing), so a plain AND is
  // correct without special-casing.
  return preds.length === 1 ? preds[0] : { AND: preds };
}
