"use client";

// PreviewStep · "Before you spend — here's the market" (step 3). Quotes the
// REAL discovery cost from preflightDiscoveryAction (estimateId + netCredits +
// fresh/refetch counts) and frames the market with KPI cards + a per-cell
// credit matrix + a what-you-picked / what-it-costs summary + a sticky dark
// costbar. "Discover →" runs runDiscoveryAction (scoped to discovery only;
// enrichment is confirmed later with real counts).
//
// NOTE: the backend preflight returns only aggregate {netCredits, freshCount,
// refetchCount}; per-cell business/enrich estimates are deterministic (mirrors
// the prototype, clearly marked ~). The headline Discover credit total is the
// REAL quote. Uses ported classes (.stat/.matrix/.costbar/.freshdot). English-
// only for now.

import { useEffect, useMemo, useState, useTransition } from "react";

import { cellKey as makeCellKey } from "@/lib/cell";
import {
  preflightDiscoveryAction,
  runDiscoveryAction,
  type PreviewCell,
  type PreviewKpis,
} from "@/modules/discovery/actions";
import { SIG_META } from "../../goal-templates";
import {
  buildCellEstimates,
  enrichCreditsFor,
  fmtCredits,
  toDiscoveryCells,
  type GoalState,
  type MarketCell,
} from "../../flow-types";
import { familiesForSignals } from "../../goal-templates";
import { useCountUp } from "../useCountUp";

interface Quote {
  estimateId: string;
  netCredits: number;
  freshCount: number;
  refetchCount: number;
  /** Per-cell rows — REAL business counts for cells already in the DB. */
  cells: PreviewCell[];
  /** Aggregate KPI inputs (real from in-DB cells + estimate from new cells). */
  kpis: PreviewKpis;
}

const FRESH_LABEL: Record<string, string> = {
  fresh: "● fresh",
  aging: "◐ aging",
  stale: "○ stale",
  new: "○ new",
};

export function PreviewStep({
  goal,
  cells,
  onBack,
  onDiscovered,
  onToast,
}: {
  goal: GoalState;
  cells: MarketCell[];
  onBack: () => void;
  /** Called with the new discoveryId once runDiscoveryAction succeeds. */
  onDiscovered: (discoveryId: string) => void;
  onToast: (msg: string) => void;
}) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pricing, startPrice] = useTransition();
  const [running, startRun] = useTransition();

  const estimates = useMemo(() => buildCellEstimates(cells), [cells]);
  const activeSignals = useMemo(
    () => goal.filters.filter((f) => f.on),
    [goal.filters],
  );
  const sigCount = activeSignals.length;

  // The active goal's registry signal keys — passed to the preflight so it can
  // count "Match your signals" over the REAL businesses of in-DB cells.
  const signalKeys = useMemo(
    () =>
      activeSignals
        .map((f) => SIG_META[f.key]?.signalKey)
        .filter((k): k is string => Boolean(k)),
    [activeSignals],
  );

  // Content key — fire the price effect ONLY when the actual cell/signal SET
  // changes. Depending on the array refs (`cells`, `signalKeys`) re-fired every
  // render — the active-signal/cell arrays are rebuilt each render — which
  // looped preflightDiscoveryAction infinitely. A string compares by value, so
  // an unchanged selection yields an unchanged dep and the effect stays put.
  const priceKey = JSON.stringify({
    cells: toDiscoveryCells(cells),
    signalKeys,
  });

  // Real preflight quote when the selection changes. All state mutation lives
  // inside the transition callback (never synchronously here).
  useEffect(() => {
    startPrice(async () => {
      setError(null);
      setQuote(null);
      const r = await preflightDiscoveryAction({
        cells: toDiscoveryCells(cells),
        signalKeys,
      });
      if (r.status === "ok") {
        setQuote({
          estimateId: r.estimateId,
          netCredits: r.netCredits,
          freshCount: r.freshCount,
          refetchCount: r.refetchCount,
          cells: r.cells,
          kpis: r.kpis,
        });
      } else {
        setError(
          r.status === "invalid_input"
            ? r.message
            : `Couldn't price this (${r.status}).`,
        );
      }
    });
    // priceKey is the stable content proxy for [cells, signalKeys].
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceKey]);

  // Per-cell business count: REAL from the quote for in-DB cells, deterministic
  // estimate for never-discovered cells (keyed by request order). The credit
  // columns + freshness come from the cost estimate (buildCellEstimates).
  const bizByKey = useMemo(() => {
    const m = new Map<string, { count: number; isEstimate: boolean }>();
    for (const c of quote?.cells ?? []) {
      m.set(c.cellKey, { count: c.existingBizCount, isEstimate: c.isEstimate });
    }
    return m;
  }, [quote]);

  // Aggregate totals. Before the quote lands, fall back to the deterministic
  // estimate sum so the matrix renders immediately; after, the per-cell real
  // counts replace the estimate for in-DB cells.
  const cellKeys = useMemo(
    () => cells.map((c) => makeCellKey(c.categorySlug, c.metroSlug, "US")),
    [cells],
  );
  const totBiz = useMemo(() => {
    if (!quote) return estimates.reduce((s, c) => s + c.bizEstimate, 0);
    return cellKeys.reduce((s, k, i) => {
      const real = bizByKey.get(k);
      return s + (real ? real.count : (estimates[i]?.bizEstimate ?? 0));
    }, 0);
  }, [quote, estimates, cellKeys, bizByKey]);

  const kpis = quote?.kpis ?? null;
  // KPI cards prefer REAL aggregates from the quote; the estimate contribution
  // from new cells is added on top, with a "~" only when estimate cells exist.
  const localBiz = kpis
    ? kpis.localBusinessesReal + kpis.localBusinessesEstimate
    : totBiz;
  const activeGoogle = kpis
    ? kpis.activeOnGoogleReal
    : Math.round(totBiz * 0.45);
  const matchReal = kpis ? kpis.matchSignalsReal : 0;
  const hasEstimate = kpis ? kpis.hasEstimateCells : true;
  const haveContactsPct = kpis
    ? kpis.localBusinessesReal > 0
      ? Math.round((kpis.haveContactsReal / kpis.localBusinessesReal) * 100)
      : 0
    : 74;

  const knownCells = useMemo(
    () =>
      quote
        ? quote.cells.filter((c) => !c.isEstimate).length
        : estimates.filter(
            (c) => c.freshness === "fresh" || c.freshness === "aging",
          ).length,
    [quote, estimates],
  );
  const newCells = (quote?.cells.length ?? estimates.length) - knownCells;

  function run() {
    if (!quote) return;
    setError(null);
    startRun(async () => {
      const r = await runDiscoveryAction({ estimateId: quote.estimateId });
      if (r.status === "ok") {
        onDiscovered(r.discoveryId);
      } else if (r.status === "needs_requote") {
        setQuote(null);
        setError("Prices changed — re-pricing…");
      } else if (r.status === "quote_expired") {
        setQuote(null);
        setError("This quote expired — re-pricing…");
      } else if (r.status === "needs_approval") {
        setError("This run is over the auto limit and needs owner approval.");
      } else if (r.status === "insufficient_credits") {
        setError("Not enough credits — add credits to run this.");
        onToast("Not enough credits");
      } else {
        setError(`Couldn't start discovery (${r.status}).`);
      }
    });
  }

  // Per-research enrichment estimate (credits) for the summary.
  const families = familiesForSignals(
    activeSignals
      .map((f) => SIG_META[f.key]?.signalKey)
      .filter((k): k is string => Boolean(k)),
  );
  const totEnrEstimate = enrichCreditsFor(families, totBiz, cells.length);

  const totDiscoverCredits = quote?.netCredits ?? 0;

  return (
    <div style={{ paddingBottom: 120 }}>
      <h1>
        Before you spend — <span className="hl">here&apos;s the market</span>
      </h1>
      <p className="sub">
        Here&apos;s an estimate of what this will find and cost — nothing is
        charged until you confirm. New or aging markets are mapped live, so
        their numbers are approximate (~).
      </p>

      {/* Freshness callout */}
      {newCells > 0 && knownCells > 0 ? (
        <div className="callout amber section" role="status">
          <span aria-hidden="true">🕗</span>
          <div>
            <b>Mixed markets</b> — {knownCells} already mapped (real counts from
            cache), {newCells} mapped live on Discover (approximate).
          </div>
        </div>
      ) : newCells > 0 ? (
        <div className="callout amber section" role="status">
          <span aria-hidden="true">🆕</span>
          <div>
            <b>New markets</b> — we map them live on Discover, so every number
            here is an estimate.
          </div>
        </div>
      ) : (
        <div className="callout green section" role="status">
          <span aria-hidden="true">✅</span>
          <div>
            <b>Recently mapped</b> — numbers are from our latest snapshot.
          </div>
        </div>
      )}

      {/* 4 KPI cards — REAL aggregates from in-DB cells; a "~" appears only when
          never-discovered cells contribute an estimate (honest mixing). */}
      <div className="grid g4 section">
        <StatCard
          k="Local businesses in market"
          to={localBiz}
          estimate={hasEstimate}
          d={`across ${cells.length} cell${cells.length === 1 ? "" : "s"}`}
        />
        <StatCard
          k="Have contacts"
          to={haveContactsPct}
          suffix="%"
          estimate={hasEstimate || knownCells === 0}
          d={
            knownCells > 0
              ? "reachable by email/phone/social"
              : "est. reachable by email/phone/social"
          }
        />
        <StatCard
          k="Active on Google"
          to={activeGoogle}
          estimate={hasEstimate || knownCells === 0}
          d="recent reviews, open now"
        />
        <StatCard
          k="Match your signals"
          to={matchReal}
          emDash={knownCells === 0}
          estimate={false}
          indigo
          d={
            knownCells === 0
              ? "computed after discovery"
              : `your ${sigCount} signal${sigCount === 1 ? "" : "s"} applied`
          }
        />
      </div>
      <p className="note section">
        {hasEstimate
          ? "Real counts where the market is already mapped; new cells (~) are confirmed live on Discover."
          : "Real counts from our latest snapshot — confirmed live on Discover before you spend on enrichment."}
      </p>

      {/* Per-cell credit matrix */}
      <div className="card section">
        <h2 style={{ margin: "0 0 6px" }}>Per-cell credit matrix</h2>
        <div className="scroll-x">
          <table className="matrix">
            <thead>
              <tr>
                <th>Market</th>
                <th>Freshness</th>
                <th>Businesses</th>
                <th>Discover</th>
                <th>Enrich</th>
              </tr>
            </thead>
            <tbody>
              {estimates.map((c, i) => {
                const real = bizByKey.get(cellKeys[i]);
                const bizCount = real ? real.count : c.bizEstimate;
                const bizIsEstimate = real ? real.isEstimate : true;
                return (
                  <tr key={c.name}>
                    <td className="biz">{c.name}</td>
                    <td>
                      <span className="freshlbl">
                        <span
                          className={`freshdot ${c.freshness}`}
                          aria-hidden="true"
                        />
                        {FRESH_LABEL[c.freshness]}
                      </span>
                    </td>
                    <td>
                      {bizIsEstimate ? "~" : ""}
                      {bizCount.toLocaleString()}
                    </td>
                    <td>
                      <span className="cr">
                        <span className="ic-coin sm" aria-hidden="true" />
                        {c.discoverCredits}
                      </span>
                    </td>
                    <td>
                      <span className="cr">
                        <span className="ic-coin sm" aria-hidden="true" />~
                        {c.enrichCreditsEstimate}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>
                  Total ({cells.length} cell{cells.length === 1 ? "" : "s"})
                </td>
                <td />
                <td>
                  {hasEstimate ? "~" : ""}
                  {totBiz.toLocaleString()}
                </td>
                <td>
                  <span className="cr">
                    <span className="ic-coin sm" aria-hidden="true" />
                    {pricing ? "…" : totDiscoverCredits}
                  </span>
                </td>
                <td>
                  <span className="cr">
                    <span className="ic-coin sm" aria-hidden="true" />~
                    {totEnrEstimate}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="note" style={{ marginTop: 10 }}>
          Enrich credits are approximate — they scale with the real business
          count we find on Discover.
        </p>
      </div>

      {/* What you picked / what it costs */}
      <div
        className="grid section"
        style={{ gridTemplateColumns: "1.1fr 0.9fr" }}
      >
        <div className="card">
          <div className="eyebrow">What you picked</div>
          <p className="note" style={{ margin: "6px 0 4px" }}>
            Goal: <b style={{ color: "var(--ink)" }}>{goal.name}</b>
          </p>
          <p className="note" style={{ margin: "0 0 10px" }}>
            Markets: <b style={{ color: "var(--ink)" }}>{cells.length}</b> cell
            {cells.length === 1 ? "" : "s"} of local businesses
          </p>
          <div>
            {activeSignals.map((f) => {
              const meta = SIG_META[f.key];
              if (!meta) return null;
              return (
                <span
                  className="pill indigo"
                  key={f.key}
                  style={{ margin: "0 6px 6px 0" }}
                >
                  {meta.title}
                </span>
              );
            })}
          </div>
        </div>
        <div className="card">
          <div className="eyebrow">What it costs</div>
          <div className="enr-sub" style={{ paddingLeft: 0 }}>
            <span className="lbl">
              ① Discover {cells.length} market{cells.length === 1 ? "" : "s"}
            </span>
            <span className="cr">
              <span className="ic-coin sm" aria-hidden="true" />
              {pricing ? "…" : totDiscoverCredits}
            </span>
          </div>
          <p className="note" style={{ margin: "2px 0 10px" }}>
            The only exact cost — runs first. ~30 sec per cell.
          </p>
          <div className="enr-sub" style={{ paddingLeft: 0 }}>
            <span className="lbl">② Enrich — after discovery</span>
            <span className="cr">
              <span className="ic-coin sm" aria-hidden="true" />~
              {totEnrEstimate}
            </span>
          </div>
          <div className="enr-sub" style={{ paddingLeft: 0, fontWeight: 700 }}>
            <span className="lbl" style={{ color: "var(--ink)" }}>
              Estimated total
            </span>
            <span className="cr" style={{ color: "var(--ink)" }}>
              <span className="ic-coin sm" aria-hidden="true" />~
              {fmtCredits(totDiscoverCredits + totEnrEstimate)}
            </span>
          </div>
        </div>
      </div>

      {error ? (
        <p className="callout amber section" role="alert">
          {error}
        </p>
      ) : null}

      {/* Sticky dark costbar — prices ONLY discovery */}
      <div className="costbar">
        <div>
          <div className="big">
            <span className="ic-coin" aria-hidden="true" /> Discover{" "}
            {cells.length} market{cells.length === 1 ? "" : "s"} —{" "}
            {pricing ? "pricing…" : `${fmtCredits(totDiscoverCredits)} credits`}
          </div>
          <div className="small">
            Only Discover runs now — you confirm enrichment after, with real
            counts.
          </div>
        </div>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onBack}>
          ← Back
        </button>
        <button
          type="button"
          className="btn primary big"
          disabled={!quote || pricing || running}
          onClick={run}
        >
          {running ? "Starting…" : "Discover →"}
        </button>
      </div>
    </div>
  );
}

function StatCard({
  k,
  to,
  suffix,
  d,
  indigo,
  emDash,
  estimate = true,
}: {
  k: string;
  to: number;
  suffix?: string;
  d: string;
  indigo?: boolean;
  emDash?: boolean;
  /** Prefix the value with "~" (an estimate). Real counts pass false. */
  estimate?: boolean;
}) {
  const v = useCountUp(to);
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div
        className="v"
        style={indigo ? { color: "var(--indigo)" } : undefined}
      >
        {emDash ? (
          "—"
        ) : (
          <>
            {estimate ? "~" : ""}
            {v.toLocaleString()}
            {suffix ?? ""}
          </>
        )}
      </div>
      <div className="d">{d}</div>
    </div>
  );
}
