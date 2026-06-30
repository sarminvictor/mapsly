"use client";

// GetLeadsFlow · the resumable 5-step "Get leads" journey
// (Goal ▸ Market ▸ Preview ▸ Discover ▸ Enrich). One client component owns the
// flow and switches views — but the flow state lives in the URL (search params),
// not React state, so a refresh / Back / shared link RESUMES exactly where the
// user was instead of restarting at Goal.
//
// URL is the source of truth (same /discover route, query params):
//   ?step=goal|market|preview|discover|enriching
//   ?goal=<templateKey>            (the GoalState reconstructs via loadGoalFrom)
//   ?sig=<onKey,onKey,…>           (which signals are toggled on — preserves edits)
//   ?cells=<metroSlug:categoryId,…> (the curated markets; rebuilt from the props)
//   ?d=<discoveryId>               (set once discovery runs)
//   ?run=<runId>&n=<leadCount>     (set once enrichment runs)
//
// We `replace` for in-step selection (no history spam) and `push` for step
// changes (so the browser Back button walks the steps). The derived step is
// clamped to what the available state actually supports, so a stale/deep link
// can never land on a blank step.
//
// State threading still flows GOAL → MARKET → PREVIEW → DISCOVER → ENRICHING,
// wiring the REAL server actions. Uses the prototype's ported classes. English-only.

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  FLOW_STEPS,
  fallbackGoal,
  loadGoalFrom,
  type FlowStep,
  type GoalState,
  type MarketCell,
} from "../flow-types";
import { templateByKey } from "../goal-templates";
import { GoalStep } from "./steps/GoalStep";
import {
  MarketStep,
  type CategoryOption,
  type MetroOption,
} from "./steps/MarketStep";
import { PreviewStep } from "./steps/PreviewStep";
import { DiscoverStep } from "./steps/DiscoverStep";
import { EnrichingStep } from "./steps/EnrichingStep";

const FLOW_KEYS = FLOW_STEPS.map((s) => s.key);
function isFlowStep(x: string | null): x is FlowStep {
  return x != null && (FLOW_KEYS as string[]).includes(x);
}

/** `metroSlug:categoryId` per cell — the rest rebuilds from the metro/category props. */
function encodeCells(cells: MarketCell[]): string {
  return cells.map((c) => `${c.metroSlug}:${c.categoryId}`).join(",");
}
function parseCells(
  raw: string | null,
  metros: MetroOption[],
  categories: CategoryOption[],
): MarketCell[] {
  if (!raw) return [];
  const metroBySlug = new Map(metros.map((m) => [m.slug, m]));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const out: MarketCell[] = [];
  for (const pair of raw.split(",")) {
    const sep = pair.indexOf(":");
    if (sep < 0) continue;
    const metroSlug = pair.slice(0, sep);
    const categoryId = pair.slice(sep + 1);
    const m = metroBySlug.get(metroSlug);
    const c = catById.get(categoryId);
    if (!m || !c) continue; // unresolvable (stale slug/id) — drop it
    out.push({
      city: m.name,
      metroSlug: m.slug,
      category: c.label,
      categoryId: c.id,
      categorySlug: c.slug,
    });
  }
  return out;
}

/** Reconstruct the working GOAL from its template key + the on-signal set. */
function decodeGoal(
  goalKey: string | null,
  sig: string | null,
): GoalState | null {
  if (!goalKey) return null;
  const tpl = templateByKey(goalKey);
  if (!tpl) return null;
  const g = loadGoalFrom(tpl);
  if (sig != null) {
    const on = new Set(sig.split(",").filter(Boolean));
    // The template's DEFAULT on-set, captured before the URL sig is applied.
    const defaultOn = new Set(g.filters.filter((f) => f.on).map((f) => f.key));
    g.filters = g.filters.map((f) => ({ ...f, on: on.has(f.key) }));
    // "Customized" ONLY when the chosen signal set actually differs from the
    // template default — not merely because a sig is present in the URL (it
    // always is, since we persist the on-set there). Compare the sets by value.
    const currentOn = g.filters.filter((f) => f.on).map((f) => f.key);
    g.customized =
      currentOn.length !== defaultOn.size ||
      currentOn.some((k) => !defaultOn.has(k));
  }
  return g;
}
function encodeGoal(goal: GoalState): { goal: string; sig: string } {
  return {
    goal: goal.base,
    sig: goal.filters
      .filter((f) => f.on)
      .map((f) => f.key)
      .join(","),
  };
}

export function GetLeadsFlow({
  metros,
  categories,
  walletCredits,
}: {
  metros: MetroOption[];
  categories: CategoryOption[];
  walletCredits?: number;
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // ── Derive ALL flow state from the URL ──────────────────────────────────
  const goal = useMemo(() => decodeGoal(sp.get("goal"), sp.get("sig")), [sp]);
  const cells = useMemo(
    () => parseCells(sp.get("cells"), metros, categories),
    [sp, metros, categories],
  );
  const discoveryId = sp.get("d");
  const runId = sp.get("run");
  const leadCount = Number(sp.get("n")) || 0;

  // Clamp the requested step to what the available state can actually render —
  // a deep/stale link can't strand the user on a blank step.
  const rawStep = sp.get("step");
  let step: FlowStep = isFlowStep(rawStep) ? rawStep : "goal";
  if (step === "enriching" && (!runId || !discoveryId))
    step = discoveryId ? "discover" : cells.length ? "preview" : "market";
  if (step === "discover" && !discoveryId)
    step = cells.length ? "preview" : "market";
  if (step === "preview" && cells.length === 0) step = "market";
  if (step === "market" && !goal) step = "goal";

  // Transient UI that doesn't need to survive a reload.
  const [mode, setMode] = useState<"target" | "search">("target");
  const [searchLeadCount, setSearchLeadCount] = useState(50);
  const [toast, setToast] = useState<string | null>(null);

  // ── URL writers ─────────────────────────────────────────────────────────
  const setParams = useCallback(
    (
      patch: Record<string, string | number | null | undefined>,
      push = false,
    ) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, String(v));
      }
      const url = `${pathname}?${next.toString()}`;
      if (push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [sp, pathname, router],
  );

  const goTo = useCallback(
    (
      s: FlowStep,
      extra: Record<string, string | number | null | undefined> = {},
    ) => setParams({ step: s, ...extra }, true),
    [setParams],
  );
  const setGoal = useCallback(
    (g: GoalState) => setParams(encodeGoal(g)),
    [setParams],
  );
  const setCells = useCallback(
    (c: MarketCell[]) => setParams({ cells: encodeCells(c) }),
    [setParams],
  );

  // The active goal — falls back to the website preset for display only.
  const activeGoal = goal ?? fallbackGoal();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  return (
    <div className="view wide">
      <Stepper current={step} />

      {step === "goal" ? (
        <>
          <h1>
            What do you <span className="hl">sell</span>?
          </h1>
          <p className="sub">
            Pick the goal closest to your agency — each is a saved bundle of{" "}
            <b>expert signals</b> that pinpoints the businesses who need exactly
            that. Tune the signal set right here, then pick your market.
          </p>
          <GoalStep
            goal={goal}
            onChange={setGoal}
            onContinue={() => goTo("market")}
          />
        </>
      ) : null}

      {step === "market" ? (
        <>
          <h1>
            Where should we <span className="hl">look</span>?
          </h1>
          <p className="sub">
            Two ways in: target the exact cities &amp; categories you want, or
            search everything we&apos;ve already mapped.
          </p>
          <MarketStep
            goal={activeGoal}
            metros={metros}
            categories={categories}
            cells={cells}
            onCellsChange={setCells}
            mode={mode}
            onModeChange={setMode}
            leadCount={searchLeadCount}
            onLeadCountChange={setSearchLeadCount}
            onEditSignals={() => goTo("goal")}
            onBack={() => goTo("goal")}
            onContinue={() => goTo("preview")}
            onToast={showToast}
          />
        </>
      ) : null}

      {step === "preview" ? (
        <PreviewStep
          goal={activeGoal}
          cells={cells}
          onBack={() => goTo("market")}
          onDiscovered={(id) => goTo("discover", { d: id })}
          onToast={showToast}
        />
      ) : null}

      {step === "discover" && discoveryId ? (
        <DiscoverStep
          discoveryId={discoveryId}
          goal={activeGoal}
          cells={cells}
          walletCredits={walletCredits}
          onEnriching={(info) =>
            goTo("enriching", { run: info.runId, n: info.leadCount })
          }
          onToast={showToast}
        />
      ) : null}

      {step === "enriching" && runId && discoveryId ? (
        <EnrichingStep
          runId={runId}
          discoveryId={discoveryId}
          leadCount={leadCount}
        />
      ) : null}

      {toast ? (
        <div
          className="toast"
          role="status"
          aria-live="polite"
          style={{ opacity: 1 }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function Stepper({ current }: { current: FlowStep }) {
  const idx = FLOW_STEPS.findIndex((s) => s.key === current);
  return (
    <div className="steps" id="get-leads-steps">
      {FLOW_STEPS.map((s, i) => {
        const cls = i < idx ? "s done" : i === idx ? "s cur" : "s";
        return (
          <span key={s.key} style={{ display: "contents" }}>
            <span className={cls}>
              <span className="n">{i < idx ? "✓" : i + 1}</span>
              {s.label}
            </span>
            {i < FLOW_STEPS.length - 1 ? <span className="line" /> : null}
          </span>
        );
      })}
    </div>
  );
}
