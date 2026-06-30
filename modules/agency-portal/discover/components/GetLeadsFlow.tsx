"use client";

// GetLeadsFlow · the resumable 5-step "Get leads" journey
// (Goal ▸ Market ▸ Preview ▸ Discover ▸ Enrich). One client component owns the
// flow state and switches views — exactly like the prototype's go(id) router —
// so the whole journey lives on /discover without new routes. Each step wires
// the REAL server actions (preflight/run discovery, preflight/run enrich,
// fetch raw list) and the jobs feed.
//
// State threading:
//   GOAL (signal set, chosen once)  →  MARKET (curated cells, reads goal)
//   →  PREVIEW (preflightDiscoveryAction quote)  →  DISCOVER (runDiscoveryAction
//   → fetchRawListAction)  →  ENRICHING (preflightEnrichAction → runEnrichAction
//   → poll /api/agency/jobs).
//
// Uses the prototype's ported classes (.steps/.view …). English-only for now.

import { useState } from "react";

import {
  FLOW_STEPS,
  fallbackGoal,
  type FlowStep,
  type GoalState,
  type MarketCell,
} from "../flow-types";
import { GoalStep } from "./steps/GoalStep";
import {
  MarketStep,
  type CategoryOption,
  type MetroOption,
} from "./steps/MarketStep";
import { PreviewStep } from "./steps/PreviewStep";
import { DiscoverStep } from "./steps/DiscoverStep";
import { EnrichingStep } from "./steps/EnrichingStep";

export function GetLeadsFlow({
  metros,
  categories,
  walletCredits,
}: {
  metros: MetroOption[];
  categories: CategoryOption[];
  walletCredits?: number;
}) {
  const [step, setStep] = useState<FlowStep>("goal");
  const [goal, setGoal] = useState<GoalState | null>(null);
  const [cells, setCells] = useState<MarketCell[]>([]);
  const [mode, setMode] = useState<"target" | "search">("target");
  const [leadCount, setLeadCount] = useState(50);
  const [discoveryId, setDiscoveryId] = useState<string | null>(null);
  const [enrichRun, setEnrichRun] = useState<{
    runId: string;
    leadCount: number;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // The active goal — falls back to the website preset for display only.
  const activeGoal = goal ?? fallbackGoal();

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }

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
            onContinue={() => setStep("market")}
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
            leadCount={leadCount}
            onLeadCountChange={setLeadCount}
            onEditSignals={() => setStep("goal")}
            onBack={() => setStep("goal")}
            onContinue={() => setStep("preview")}
            onToast={showToast}
          />
        </>
      ) : null}

      {step === "preview" ? (
        <PreviewStep
          goal={activeGoal}
          cells={cells}
          onBack={() => setStep("market")}
          onDiscovered={(id) => {
            setDiscoveryId(id);
            setStep("discover");
          }}
          onToast={showToast}
        />
      ) : null}

      {step === "discover" && discoveryId ? (
        <DiscoverStep
          discoveryId={discoveryId}
          goal={activeGoal}
          cells={cells}
          walletCredits={walletCredits}
          onEnriching={(info) => {
            setEnrichRun(info);
            setStep("enriching");
          }}
          onToast={showToast}
        />
      ) : null}

      {step === "enriching" && enrichRun && discoveryId ? (
        <EnrichingStep
          runId={enrichRun.runId}
          discoveryId={discoveryId}
          leadCount={enrichRun.leadCount}
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
