"use client";

// DiscoverFlow · the demand-discovery entry flow (Phase 9): pick metros ×
// categories → see the pre-flight cost (fresh cells = $0) → run discovery.
// Wires the real server actions (preflightDiscoveryAction / runDiscoveryAction)
// to the CostQuoteBar. Copy is English-only for now (the app runs English-only;
// i18n keys are a follow-up — see i18n/routing.ts note).

import { useMemo, useState, useTransition } from "react";
import {
  preflightDiscoveryAction,
  runDiscoveryAction,
} from "@/modules/discovery/actions";
import { CostQuoteBar } from "./CostQuoteBar";

export interface DiscoverMetro {
  slug: string;
  name: string;
}
export interface DiscoverCategory {
  id: string;
  slug: string;
  label: string;
}

interface QuoteState {
  estimateId: string;
  netUsd: number;
  netCredits: number;
  freshCount: number;
  refetchCount: number;
}

export function DiscoverFlow({
  metros,
  categories,
  walletUsd,
}: {
  metros: DiscoverMetro[];
  categories: DiscoverCategory[];
  walletUsd?: number;
}) {
  const [metroSlugs, setMetroSlugs] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [discoveryId, setDiscoveryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const cells = useMemo(() => {
    const picked = categories.filter((c) => categoryIds.includes(c.id));
    const out: {
      categorySlug: string;
      categoryId: string;
      metroSlug: string;
      country: string;
    }[] = [];
    for (const m of metroSlugs) {
      for (const c of picked) {
        out.push({
          categorySlug: c.slug,
          categoryId: c.id,
          metroSlug: m,
          country: "US",
        });
      }
    }
    return out;
  }, [metroSlugs, categoryIds, categories]);

  const gate: "auto" | "confirm" | "approval" = !quote
    ? "auto"
    : quote.netUsd > 5
      ? "approval"
      : quote.netUsd >= 2
        ? "confirm"
        : "auto";

  function toggle(list: string[], v: string): string[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  function preview() {
    setError(null);
    setDiscoveryId(null);
    startTransition(async () => {
      const r = await preflightDiscoveryAction({ cells });
      if (r.status === "ok") {
        setQuote({
          estimateId: r.estimateId,
          netUsd: Number.parseFloat(r.netUsd),
          netCredits: r.netCredits,
          freshCount: r.freshCount,
          refetchCount: r.refetchCount,
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
    if (!quote) return;
    setError(null);
    startTransition(async () => {
      const r = await runDiscoveryAction({ estimateId: quote.estimateId });
      if (r.status === "ok") {
        setDiscoveryId(r.discoveryId);
      } else if (r.status === "needs_requote") {
        setQuote(null);
        setError("Prices changed — preview the cost again.");
      } else if (r.status === "quote_expired") {
        setQuote(null);
        setError("This quote expired — preview the cost again.");
      } else if (r.status === "needs_approval") {
        setError("This run is over $5 and needs owner approval.");
      } else if (r.status === "insufficient_credits") {
        setError("Not enough credits — add credits to run this.");
      } else {
        setError(`Couldn't start discovery (${r.status}).`);
      }
    });
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Metros */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          1 · Metros{" "}
          <span className="font-normal text-slate-500">
            ({metroSlugs.length} selected · fixed ~30km radius)
          </span>
        </h2>
        <div className="flex flex-wrap gap-2">
          {metros.map((m) => {
            const on = metroSlugs.includes(m.slug);
            return (
              <button
                key={m.slug}
                type="button"
                onClick={() => {
                  setMetroSlugs((s) => toggle(s, m.slug));
                  setQuote(null);
                }}
                className={`rounded-full border px-3 py-1 text-sm ${on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}
              >
                {m.name}
              </button>
            );
          })}
        </div>
      </section>

      {/* Categories */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          2 · Categories{" "}
          <span className="font-normal text-slate-500">
            ({categoryIds.length} selected)
          </span>
        </h2>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => {
            const on = categoryIds.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCategoryIds((s) => toggle(s, c.id));
                  setQuote(null);
                }}
                className={`rounded-full border px-3 py-1 text-sm ${on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Cells math + preview */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-700">
          <b>{metroSlugs.length}</b> metros × <b>{categoryIds.length}</b>{" "}
          categories = <b>{cells.length}</b> cells
        </p>
        <button
          type="button"
          disabled={cells.length === 0 || pending}
          onClick={preview}
          className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-50"
        >
          {pending ? "Pricing…" : "Preview cost"}
        </button>
        {quote ? (
          <p className="mt-3 text-sm text-slate-600">
            {quote.freshCount} cells fresh (served free) · {quote.refetchCount}{" "}
            will fetch · <b>{quote.netCredits} credits</b>
          </p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        {discoveryId ? (
          <p className="mt-3 rounded bg-emerald-50 p-2 text-sm text-emerald-700">
            Discovery started ({discoveryId.slice(0, 8)}…). Results stream in as
            the worker runs.
          </p>
        ) : null}
      </section>

      {quote ? (
        <CostQuoteBar
          netUsd={quote.netUsd}
          freshHitUsd={0}
          walletUsd={walletUsd}
          gate={gate}
          busy={pending}
          onConfirm={run}
        />
      ) : null}
    </div>
  );
}
