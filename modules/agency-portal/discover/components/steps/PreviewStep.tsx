"use client";

// PreviewStep · "Before you spend — here's the market" (step 3). Quotes the
// REAL discovery cost from preflightDiscoveryAction (estimateId + netCredits +
// fresh/refetch counts) and frames the market with KPI cards + a per-cell
// credit matrix + a what-you-picked / what-it-costs summary + a sticky dark
// costbar. "Discover →" runs runDiscoveryAction (scoped to discovery only;
// enrichment is confirmed later with real counts).
//
// HONESTY · every number in the matrix is derived from the REAL preflight quote
// (preflightDiscoveryAction → PreviewCell[]): per-cell freshness is the cell's
// real cellFreshnessState; the business count is a real Business.count for
// already-mapped cells (an estimate, flagged `~`, only for never-discovered
// cells); the per-cell ENRICH credit is computed over that count × the resolved
// research families (researchesForSignals) via the canonical ENRICHMENT_PRICES
// — NOT the old `biz × 0.18` + positional `index % 4` fabrication. Cached cells
// re-serve discovery free; stale/never cells need a fetch (the exact discovery
// total is the REAL aggregate netCredits). Uses ported classes
// (.stat/.matrix/.costbar/.freshdot). English-only for now.

import { useEffect, useMemo, useState, useTransition } from "react";

import {
  preflightDiscoveryAction,
  runDiscoveryAction,
  type PreviewCell,
  type PreviewKpis,
} from "@/modules/discovery/actions";
import { SIG_META } from "../../goal-templates";
import { researchesForSignals } from "../../researches";
import { buildDiscoverySignals } from "../../discovery-signals";
import {
  buildCellRows,
  fmtCredits,
  freshDotClass,
  toDiscoveryCells,
  type GoalState,
  type MarketCell,
  type QuoteCell,
} from "../../flow-types";
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

// Keyed by the `.freshdot` CSS class (freshDotClass maps the quote's `never`
// state → `new`). `new` = never mapped, so its counts are an estimate.
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

  const activeSignals = useMemo(
    () => goal.filters.filter((f) => f.on),
    [goal.filters],
  );
  const sigCount = activeSignals.length;

  // The research families the active signals depend on (dependency chains
  // expanded) — the canonical input to every enrich-credit computation below.
  const families = useMemo(
    () => researchesForSignals(activeSignals),
    [activeSignals],
  );

  // The active goal's registry signal keys — passed to the preflight so it can
  // count "Match your signals" over the REAL businesses of in-DB cells.
  const signalKeys = useMemo(
    () =>
      activeSignals
        .map((f) => SIG_META[f.key]?.signalKey)
        .filter((k): k is string => Boolean(k)),
    [activeSignals],
  );

  // The active goal signals (SIG_META key + tune/conds/match) — threaded to the
  // preflight so they ride the authorized estimate and get persisted onto the
  // Discovery for the workbench evaluator (P3). buildDiscoverySignals keeps only
  // on:true filters + the fields the goal actually set.
  const persistedSignals = useMemo(
    () => buildDiscoverySignals(goal.filters).signals,
    [goal.filters],
  );

  // Content key — fire the price effect ONLY when the actual cell/signal SET
  // changes. Depending on the array refs (`cells`, `signalKeys`) re-fired every
  // render — the active-signal/cell arrays are rebuilt each render — which
  // looped preflightDiscoveryAction infinitely. A string compares by value, so
  // an unchanged selection yields an unchanged dep and the effect stays put.
  // persistedSignals is included so a tune/conds/match edit (which leaves the
  // registry signalKeys unchanged) still re-quotes and re-carries the new tune.
  const priceKey = JSON.stringify({
    cells: toDiscoveryCells(cells),
    signalKeys,
    persistedSignals,
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
        signals: persistedSignals,
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

  // Per-cell rows built ENTIRELY from the REAL preflight quote: real freshness,
  // real DB business count (or a flagged estimate for never-discovered cells),
  // and per-cell enrich credits computed over that count × the resolved research
  // families. Empty until the quote lands → the matrix shows a pricing state
  // rather than fabricated numbers.
  const quoteByKey = useMemo(() => {
    const m = new Map<string, QuoteCell>();
    for (const c of quote?.cells ?? []) {
      m.set(c.cellKey, {
        cellKey: c.cellKey,
        freshness: c.freshness,
        existingBizCount: c.existingBizCount,
        isEstimate: c.isEstimate,
      });
    }
    return m;
  }, [quote]);

  const rows = useMemo(
    () => (quote ? buildCellRows(cells, quoteByKey, families) : []),
    [quote, cells, quoteByKey, families],
  );

  // Aggregate business count = sum of the per-cell (real-or-estimated) counts.
  const totBiz = useMemo(
    () => rows.reduce((s, r) => s + r.bizCount, 0),
    [rows],
  );
  // Aggregate enrich credits = sum of the per-cell enrich credits, so the matrix
  // footer + the cost summary always equal the rows above them.
  const totEnr = useMemo(
    () => rows.reduce((s, r) => s + r.enrichCredits, 0),
    [rows],
  );

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

  // Already-mapped (real counts) vs never-discovered (estimate) cells — drives
  // the freshness callout. Derived from the REAL quote; 0 until it lands.
  const knownCells = useMemo(
    () => (quote ? quote.cells.filter((c) => !c.isEstimate).length : 0),
    [quote],
  );
  const newCells = (quote?.cells.length ?? 0) - knownCells;

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
              {rows.length === 0 ? (
                <tr>
                  <td className="biz" colSpan={5}>
                    {pricing
                      ? "Pricing this market…"
                      : "Add markets to see the per-cell breakdown."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const dot = freshDotClass(r.freshness);
                  return (
                    <tr key={r.name}>
                      <td className="biz">{r.name}</td>
                      <td>
                        <span className="freshlbl">
                          <span
                            className={`freshdot ${dot}`}
                            aria-hidden="true"
                          />
                          {FRESH_LABEL[dot]}
                        </span>
                      </td>
                      <td>
                        {r.isEstimate ? "~" : ""}
                        {r.bizCount.toLocaleString()}
                      </td>
                      <td>
                        {r.discoverIsFree ? (
                          <span className="cr">
                            <span className="ic-coin sm" aria-hidden="true" />0
                          </span>
                        ) : (
                          // Stale/never cell — needs a (re)fetch; the exact
                          // per-cell cost is in the REAL aggregate total below.
                          <span className="cr">~</span>
                        )}
                      </td>
                      <td>
                        <span className="cr">
                          <span className="ic-coin sm" aria-hidden="true" />
                          {/* Real count → plain; estimated count → ~ */}
                          {r.isEstimate ? "~" : ""}
                          {r.enrichCredits.toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
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
                    <span className="ic-coin sm" aria-hidden="true" />
                    {hasEstimate ? "~" : ""}
                    {totEnr.toLocaleString()}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="note" style={{ marginTop: 10 }}>
          Enrich credits are projected over each cell&apos;s business count and
          the research your signals need. Already-mapped cells use real counts;
          never-mapped cells (~) are confirmed live on Discover. Cached cells
          (fresh/aging) re-serve discovery for free; stale/never cells (~) need
          a fetch — the exact discovery total is in the row above.
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
              {fmtCredits(totEnr)}
            </span>
          </div>
          <div className="enr-sub" style={{ paddingLeft: 0, fontWeight: 700 }}>
            <span className="lbl" style={{ color: "var(--ink)" }}>
              Estimated total
            </span>
            <span className="cr" style={{ color: "var(--ink)" }}>
              <span className="ic-coin sm" aria-hidden="true" />~
              {fmtCredits(totDiscoverCredits + totEnr)}
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
