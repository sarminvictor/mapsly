"use client";

// EnrichPanel · the right-side "Enrich" panel for the Raw List (Phase 9).
// Lists the 9 enrichment families (from ENRICHMENT_PRICES) with per-row unit
// cost + a checkbox; a live total comes from the preflightEnrichAction server
// action; the CostQuoteBar runs the enrichment. Closes the discover → raw-list
// → enrich loop. Copy is English-only for now (the app runs English-only).

import { useMemo, useState, useTransition } from "react";

import {
  ENRICHMENT_PRICES,
  ALL_ENRICHMENT_TYPES,
  type EnrichmentType,
  type ScopeUnit,
} from "@/modules/cost/pricing";
import {
  preflightEnrichAction,
  runEnrichAction,
} from "@/modules/discovery/enrich-actions";
import { CostQuoteBar } from "./CostQuoteBar";

export interface EnrichPanelProps {
  /** Selected business ids (drives per-business families). */
  businessIds: string[];
  /** Cells the run spans (drives per-cell families). */
  cellKeys: string[];
  /** Agency wallet balance in USD (optional — gates the run button). */
  walletUsd?: number;
  /** Close affordance (when rendered as a slide-over). */
  onClose?: () => void;
}

interface QuoteState {
  estimateId: string;
  netUsd: number;
  upperBoundUsd: number;
  freshHitUsd: number;
  netCredits: number;
  gate: "auto" | "confirm" | "approval";
}

function unitLabel(unit: ScopeUnit): string {
  return unit === "cell" ? "per cell" : "per business";
}

export function EnrichPanel({
  businessIds,
  cellKeys,
  walletUsd,
  onClose,
}: EnrichPanelProps) {
  const [selected, setSelected] = useState<Set<EnrichmentType>>(new Set());
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const businessCount = businessIds.length;
  const cellCount = cellKeys.length;

  // Per-row estimated count (so each row shows "× N" before pricing).
  const families = useMemo(
    () =>
      ALL_ENRICHMENT_TYPES.map((key) => {
        const price = ENRICHMENT_PRICES[key];
        const count = price.unit === "cell" ? cellCount : businessCount;
        return { key, price, count };
      }),
    [businessCount, cellCount],
  );

  const enrichments = useMemo(
    () => ALL_ENRICHMENT_TYPES.filter((k) => selected.has(k)),
    [selected],
  );

  function toggle(key: EnrichmentType) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setQuote(null);
    setRunId(null);
  }

  function priceIt() {
    setError(null);
    setRunId(null);
    startTransition(async () => {
      const r = await preflightEnrichAction({
        businessIds,
        cellKeys,
        enrichments,
      });
      if (r.status === "ok") {
        setQuote({
          estimateId: r.estimateId,
          netUsd: r.netUsd,
          upperBoundUsd: r.upperBoundUsd,
          freshHitUsd: r.freshHitUsd,
          netCredits: r.netCredits,
          gate: r.gate,
        });
      } else {
        setQuote(null);
        setError(
          r.status === "invalid_input"
            ? r.message
            : `Couldn't price this (${r.status}).`,
        );
      }
    });
  }

  function run() {
    setError(null);
    startTransition(async () => {
      const r = await runEnrichAction({ businessIds, cellKeys, enrichments });
      if (r.status === "ok") setRunId(r.runId);
      else setError(`Couldn't start enrichment (${r.status}).`);
    });
  }

  return (
    <aside className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Enrich</h2>
          <p className="font-mono text-xs text-slate-500">
            {businessCount} businesses · {cellCount} cells
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close enrich panel"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {families.map(({ key, price, count }) => {
            const on = selected.has(key);
            const lineUsd = count * price.usdPerUnit;
            return (
              <li key={key}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 ${
                    on
                      ? "border-indigo-300 bg-indigo-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(key)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800">
                        {price.label}
                      </span>
                      <span className="font-mono text-xs text-slate-500">
                        ${lineUsd.toFixed(2)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 font-mono text-xs text-slate-400">
                      <span>{unitLabel(price.unit)}</span>
                      <span aria-hidden>·</span>
                      <span>× {count}</span>
                      <span aria-hidden>·</span>
                      <span>{price.freshnessDays}d fresh</span>
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {error ? (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {runId ? (
          <p className="mt-3 rounded bg-emerald-50 p-2 text-sm text-emerald-700">
            Enrichment started ({runId.slice(0, 8)}…). Results stream in as the
            worker runs.
          </p>
        ) : null}
      </div>

      <div className="border-t border-slate-200 p-3">
        {quote ? (
          <CostQuoteBar
            netUsd={quote.netUsd}
            freshHitUsd={quote.freshHitUsd}
            walletUsd={walletUsd}
            gate={quote.gate}
            busy={pending}
            onConfirm={run}
          />
        ) : (
          <button
            type="button"
            disabled={enrichments.length === 0 || pending}
            onClick={priceIt}
            className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? "Pricing…"
              : enrichments.length === 0
                ? "Select enrichments"
                : `Preview cost · ${enrichments.length} selected`}
          </button>
        )}
      </div>
    </aside>
  );
}
