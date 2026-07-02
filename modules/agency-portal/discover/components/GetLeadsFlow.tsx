"use client";

// GetLeadsFlow · the resumable 4-step "Get leads" journey
// (Goal ▸ Market ▸ Preview ▸ Enrich). One client component owns the flow and
// switches views — but the flow state lives in the URL (search params), not
// React state, so a refresh / Back / shared link RESUMES exactly where the
// user was instead of restarting at Goal.
//
// There is deliberately no separate "Discover" step: Preview auto-triggers
// discovery in the background the moment it mounts and reveals real numbers
// as the market maps — see PreviewStep.tsx for the merged implementation.
//
// URL is the source of truth (same /discover route, query params):
//   ?step=goal|market|preview|enriching
//   ?goal=<templateKey>            (the GoalState reconstructs via loadGoalFrom)
//   ?sig=<onKey,onKey,…>           (which signals are toggled on — preserves edits)
//   ?cells=<metroSlug:categoryId,…> (the curated markets; rebuilt from the props)
//   ?d=<discoveryId>               (set once enrichment starts, for the Enriching step)
//   ?run=<runId>&n=<leadCount>     (set once enrichment runs)
//
// We `replace` for in-step selection (no history spam) and `push` for step
// changes (so the browser Back button walks the steps). The derived step is
// clamped to what the available state actually supports, so a stale/deep link
// can never land on a blank step.
//
// State threading flows GOAL → MARKET → PREVIEW → ENRICHING, wiring the REAL
// server actions. Uses the prototype's ported classes. English-only.

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { showToast } from "@/components/agency/Toast";
import {
  FLOW_STEPS,
  fallbackGoal,
  parseEnrichTypes,
  type FlowStep,
  type GoalState,
  type MarketCell,
} from "../flow-types";
import { decodeGoal, encodeGoal } from "../goal-url";
import type { SavedTemplateRow } from "../saved-templates";
import { GoalStep } from "./steps/GoalStep";
import {
  MarketStep,
  type CategoryOption,
  type MetroOption,
} from "./steps/MarketStep";
import { PreviewStep } from "./steps/PreviewStep";
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
      country: m.country,
    });
  }
  return out;
}

export function GetLeadsFlow({
  metros,
  categories,
  walletCredits,
  locale,
  myTemplates = [],
}: {
  metros: MetroOption[];
  categories: CategoryOption[];
  walletCredits?: number;
  /** Locale for the credit-wall sheet's checkout return URL (WP2-3). */
  locale: string;
  /** The agency's saved goal templates (WP5-12) — server-loaded, plain rows. */
  myTemplates?: SavedTemplateRow[];
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // ── Derive ALL flow state from the URL ──────────────────────────────────
  const goal = useMemo(
    () => decodeGoal(sp.get("goal"), sp.get("sig"), sp.get("g")),
    [sp],
  );
  const cells = useMemo(
    () => parseCells(sp.get("cells"), metros, categories),
    [sp, metros, categories],
  );
  const discoveryId = sp.get("d");
  const runId = sp.get("run");
  const leadCount = Number(sp.get("n")) || 0;
  // WP5-3 · `?enrich=<types>` deep link (workbench coverage CTAs / locked
  // columns) — pre-seeds the enrichment families Preview quotes + runs. The
  // URL is the source of truth, same as every other flow param.
  const extraEnrichTypes = useMemo(
    () => parseEnrichTypes(sp.get("enrich")),
    [sp],
  );

  // Clamp the requested step to what the available state can actually render —
  // a deep/stale link can't strand the user on a blank step.
  const rawStep = sp.get("step");
  let step: FlowStep = isFlowStep(rawStep) ? rawStep : "goal";
  if (step === "enriching" && (!runId || !discoveryId))
    step = cells.length ? "preview" : "market";
  if (step === "preview" && cells.length === 0) step = "market";
  if (step === "market" && !goal) step = "goal";

  // Transient UI that doesn't need to survive a reload.
  const [mode, setMode] = useState<"target" | "search">("target");
  const [searchLeadCount, setSearchLeadCount] = useState(50);

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

  return (
    <div className="view wide">
      <Stepper current={step} onJump={(s) => goTo(s)} />

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
            myTemplates={myTemplates}
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
          walletCredits={walletCredits}
          locale={locale}
          extraEnrichTypes={extraEnrichTypes}
          onBack={() => goTo("market")}
          onEnriching={(info) =>
            goTo("enriching", {
              run: info.runId,
              n: info.leadCount,
              d: info.discoveryId,
            })
          }
        />
      ) : null}

      {step === "enriching" && runId && discoveryId ? (
        <EnrichingStep
          runId={runId}
          discoveryId={discoveryId}
          leadCount={leadCount}
        />
      ) : null}
    </div>
  );
}

function Stepper({
  current,
  onJump,
}: {
  current: FlowStep;
  /** Jump back to an already-completed step (WP4-15). URL-state + the step
   *  clamp make back-jumps safe — a jump to a step the state can't render is
   *  re-clamped by GetLeadsFlow. */
  onJump: (step: FlowStep) => void;
}) {
  const idx = FLOW_STEPS.findIndex((s) => s.key === current);
  return (
    <div className="steps" id="get-leads-steps">
      {FLOW_STEPS.map((s, i) => {
        const done = i < idx;
        const cls = done ? "s done" : i === idx ? "s cur" : "s";
        const inner = (
          <>
            <span className="n">{done ? "✓" : i + 1}</span>
            {s.label}
          </>
        );
        return (
          <span key={s.key} style={{ display: "contents" }}>
            {done ? (
              // Completed steps are tappable — jump back to revise a choice.
              <button
                type="button"
                className={cls}
                onClick={() => onJump(s.key)}
                aria-label={`Go back to ${s.label}`}
              >
                {inner}
              </button>
            ) : (
              <span
                className={cls}
                aria-current={i === idx ? "step" : undefined}
              >
                {inner}
              </span>
            )}
            {i < FLOW_STEPS.length - 1 ? <span className="line" /> : null}
          </span>
        );
      })}
    </div>
  );
}
