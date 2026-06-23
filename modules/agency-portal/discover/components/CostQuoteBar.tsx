"use client";

// CostQuoteBar · the universal pre-flight cost gate shown at every spend
// (Phase 9). "This will cost $X · saved $Y from cache · wallet → $Z". Never
// blocks reading saved data; only gates spending.

import type { ReactNode } from "react";

export interface CostQuoteBarProps {
  netUsd: number;
  freshHitUsd: number;
  walletUsd?: number;
  gate: "auto" | "confirm" | "approval";
  busy?: boolean;
  onConfirm?: () => void;
  children?: ReactNode;
}

export function CostQuoteBar({
  netUsd,
  freshHitUsd,
  walletUsd,
  gate,
  busy,
  onConfirm,
  children,
}: CostQuoteBarProps) {
  const after = walletUsd != null ? walletUsd - netUsd : null;
  const insufficient = after != null && after < 0;

  return (
    <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
      <div className="text-sm text-slate-700">
        <span className="font-semibold text-slate-900">
          This will cost ${netUsd.toFixed(2)}
        </span>
        {freshHitUsd > 0 ? (
          <span className="ml-2 text-emerald-600">
            · ${freshHitUsd.toFixed(2)} saved from fresh cache
          </span>
        ) : null}
        {walletUsd != null ? (
          <span
            className={`ml-2 ${insufficient ? "text-red-600" : "text-slate-500"}`}
          >
            · wallet ${walletUsd.toFixed(2)} → ${after!.toFixed(2)}
          </span>
        ) : null}
        {gate === "approval" ? (
          <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
            needs approval
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {children}
        <button
          type="button"
          disabled={busy || insufficient || !onConfirm}
          onClick={onConfirm}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {insufficient
            ? "Add credits"
            : busy
              ? "Running…"
              : `Run · $${netUsd.toFixed(2)}`}
        </button>
      </div>
    </div>
  );
}
