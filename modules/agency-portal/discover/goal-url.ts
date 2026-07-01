// modules/agency-portal/discover/goal-url.ts · lossless GoalState ⇄ URL params.
//
// The "Get leads" flow keeps its state in the URL (refresh / Back / a shared
// link resume exactly where the user was). The GOAL is the rich part: each
// signal carries a tune-control value, per-condition toggles, and a combine
// mode; the user can also add/remove signals and rename the goal. Encoding only
// `goal=<base>&sig=<on-keys>` was LOSSY — every setting (Match all/any, a
// strictness step, a platform chip) round-tripped through the URL and reverted
// to the template default on the very next render, so the controls looked dead;
// and the tune never reached Discovery.signalsJson, so eval ran on defaults too.
//
// This module serializes the behavior-complete goal into a compact base64url
// `g` param (the lossless source of truth) and ALSO emits a human-readable
// `goal`/`sig` pair for legacy + shareable links. Decode prefers `g`; an older
// `?goal=&sig=` link still resolves via the template fallback.
//
// Pure (no React, no DB) so the round-trip is unit-tested in __tests__/goal-url.

import { SIG_META, templateByKey } from "./goal-templates";
import {
  loadGoalFrom,
  type GoalState,
  type SignalTuneValue,
} from "./flow-types";

/** UTF-8-safe base64url — filter copy carries em-dashes + smart quotes, which
 *  raw `btoa` (Latin-1 only) would throw on; encode to bytes first. */
function toB64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64Url(b: string): string {
  const bin = atob(b.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * The compact wire shape persisted in `g` — behavior-complete: every field the
 * evaluator reads (key, on, combine mode, per-condition toggles, tune value).
 * The derived `why` string is dropped and re-derived from SIG_META at decode,
 * keeping the param small.
 */
interface GoalWire {
  /** base template key */
  b: string;
  /** editable name */
  n: string;
  /** customized flag */
  c: boolean;
  /** filters */
  f: Array<{
    /** SIG_META key */
    k: string;
    on: boolean;
    /** composite combine mode */
    m?: "all" | "any";
    /** per-condition include toggles */
    cd?: Record<string, boolean>;
    /** tune-control value */
    t?: SignalTuneValue;
  }>;
}

/**
 * Serialize the goal to URL params: the lossless `g` + readable `goal`/`sig`.
 * Returns a plain `Record<string, string>` so it drops straight into the flow's
 * `setParams(patch)` writer ({ goal, sig, g }).
 */
export function encodeGoal(goal: GoalState): Record<string, string> {
  const wire: GoalWire = {
    b: goal.base,
    n: goal.name,
    c: goal.customized,
    f: goal.filters.map((f) => ({
      k: f.key,
      on: f.on,
      ...(f.match ? { m: f.match } : {}),
      ...(f.conds ? { cd: f.conds } : {}),
      ...(f.tune ? { t: f.tune } : {}),
    })),
  };
  return {
    goal: goal.base,
    sig: goal.filters
      .filter((f) => f.on)
      .map((f) => f.key)
      .join(","),
    g: toB64Url(JSON.stringify(wire)),
  };
}

/**
 * Reconstruct the working goal from the URL — the lossless `g` payload first,
 * else the legacy template-key + on-signal-set (older shared links). Returns
 * null when neither resolves to a known template.
 */
export function decodeGoal(
  goalKey: string | null,
  sig: string | null,
  g: string | null,
): GoalState | null {
  // Preferred: the lossless `g` payload (carries tune / conds / match / name).
  if (g) {
    try {
      const wire = JSON.parse(fromB64Url(g)) as GoalWire;
      if (wire && typeof wire.b === "string" && Array.isArray(wire.f)) {
        return {
          base: wire.b,
          name:
            typeof wire.n === "string"
              ? wire.n
              : (templateByKey(wire.b)?.title ?? "Custom"),
          customized: !!wire.c,
          filters: wire.f
            .filter((w) => w && typeof w.k === "string")
            .map((w) => {
              const meta = SIG_META[w.k];
              return {
                key: w.k,
                on: w.on !== false,
                why: meta?.pitch || meta?.means || "",
                ...(w.m === "all" || w.m === "any" ? { match: w.m } : {}),
                ...(w.cd && typeof w.cd === "object" ? { conds: w.cd } : {}),
                ...(w.t ? { tune: w.t } : {}),
              };
            }),
        };
      }
    } catch {
      // malformed payload — fall through to the legacy decode
    }
  }

  // Legacy / back-compat: template key + on-set only (older shared links).
  if (!goalKey) return null;
  const tpl = templateByKey(goalKey);
  if (!tpl) return null;
  const base = loadGoalFrom(tpl);
  if (sig != null) {
    const on = new Set(sig.split(",").filter(Boolean));
    // The template's DEFAULT on-set, captured before the URL sig is applied.
    const defaultOn = new Set(
      base.filters.filter((f) => f.on).map((f) => f.key),
    );
    base.filters = base.filters.map((f) => ({ ...f, on: on.has(f.key) }));
    // "Customized" only when the chosen set differs from the template default.
    const currentOn = base.filters.filter((f) => f.on).map((f) => f.key);
    base.customized =
      currentOn.length !== defaultOn.size ||
      currentOn.some((k) => !defaultOn.has(k));
  }
  return base;
}
