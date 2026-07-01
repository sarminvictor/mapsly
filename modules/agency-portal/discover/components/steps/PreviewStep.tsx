"use client";

// PreviewStep · "Before you spend — here's the market" (step 3). Discovery is
// ALWAYS free (DISCOVERY_PRICE is $0 — docs/pricing-strategy.md); this step
// frames the market with KPI cards + a per-cell composition table + a
// what-you-picked / what-it-costs summary (split by research, per lead) + a
// sticky dark costbar. "Discover →" runs runDiscoveryAction; enrichment is a
// separate, later confirmation once the real lead count is known.
//
// HONESTY · a never-discovered cell's business count is genuinely UNKNOWN —
// NEVER a guessed number (no `120 + index*137 % 341` fabrication, no `biz ×
// 0.18` positional fabrication). KPI cards + the composition table show "—"
// for anything not yet real. Enrichment is priced as a per-lead RATE (business-
// basis families' unit costs, summed once via enrichRatePerLead) + a one-time
// per-cell fee (cell-basis families via enrichCellFeeCredits) — both computed
// from the resolved research families (researchesForSignals) over the
// canonical ENRICHMENT_PRICES, and both knowable WITHOUT guessing a lead
// count, unlike a pre-multiplied total. Uses ported classes
// (.stat/.matrix/.costbar/.freshdot). English-only for now.

import { useEffect, useMemo, useState, useTransition } from "react";

import {
  preflightDiscoveryAction,
  runDiscoveryAction,
  type PreviewCell,
  type PreviewKpis,
} from "@/modules/discovery/actions";
import { ENRICHMENT_PRICES } from "@/modules/cost/pricing";
import { SIG_META } from "../../goal-templates";
import { researchesForSignals, RESEARCH_LABELS } from "../../researches";
import { buildDiscoverySignals } from "../../discovery-signals";
import {
  buildCellRows,
  enrichCellFeeCredits,
  enrichRatePerLead,
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

  // Per-cell rows built ENTIRELY from the REAL preflight quote: real freshness
  // and real DB business count. A never-discovered cell's count is genuinely
  // UNKNOWN — never a guessed number. Empty until the quote lands → the matrix
  // shows a pricing state rather than fabricated numbers.
  const quoteByKey = useMemo(() => {
    const m = new Map<string, QuoteCell>();
    for (const c of quote?.cells ?? []) {
      m.set(c.cellKey, {
        cellKey: c.cellKey,
        freshness: c.freshness,
        existingBizCount: c.existingBizCount,
        neverDiscovered: c.neverDiscovered,
      });
    }
    return m;
  }, [quote]);

  const rows = useMemo(
    () => (quote ? buildCellRows(cells, quoteByKey) : []),
    [quote, cells, quoteByKey],
  );

  // Aggregate business count = sum of ONLY the known (already-discovered)
  // cells' real counts. Never-discovered cells contribute nothing here — their
  // count is unknown, not zero, so it must never be summed into a total.
  const totBiz = useMemo(
    () =>
      rows
        .filter((r) => !r.neverDiscovered)
        .reduce((s, r) => s + r.bizCount, 0),
    [rows],
  );

  // The per-lead enrich rate + one-time cell fee — both knowable WITHOUT a
  // business count (see enrichRatePerLead/enrichCellFeeCredits docs). This is
  // what actually answers "what does enrichment cost" honestly before Discover
  // reveals how many businesses exist.
  const enrichRate = useMemo(() => enrichRatePerLead(families), [families]);
  const enrichCellFee = useMemo(
    () => enrichCellFeeCredits(families, cells.length),
    [families, cells.length],
  );
  // A real projected total is only honest for cells whose count we KNOW.
  const knownEnrichTotal = totBiz * enrichRate + enrichCellFee;

  // The "② Enrich" card's per-research breakdown (matches the prototype's
  // split-by-research design) — one row per family the active signals need,
  // labeled via RESEARCH_LABELS, tagged by its billing basis.
  const researchRows = useMemo(
    () =>
      families.map((f) => ({
        family: f,
        label: RESEARCH_LABELS[f],
        basis: ENRICHMENT_PRICES[f].unit,
      })),
    [families],
  );

  const kpis = quote?.kpis ?? null;
  // KPI cards show ONLY real aggregates from already-discovered cells — never
  // a guessed contribution from never-discovered cells (hasUnknownCells drives
  // a "+N more markets" note instead of inflating the number).
  const localBiz = kpis ? kpis.localBusinessesReal : totBiz;
  const activeGoogle = kpis ? kpis.activeOnGoogleReal : 0;
  const matchReal = kpis ? kpis.matchSignalsReal : 0;
  const hasUnknown = kpis ? kpis.hasUnknownCells : true;
  const haveContactsPct = kpis
    ? kpis.localBusinessesReal > 0
      ? Math.round((kpis.haveContactsReal / kpis.localBusinessesReal) * 100)
      : 0
    : 0;

  // Already-mapped (real counts) vs never-discovered (unknown) cells — drives
  // the freshness callout. Derived from the REAL quote; 0 until it lands.
  const knownCells = useMemo(
    () => (quote ? quote.cells.filter((c) => !c.neverDiscovered).length : 0),
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

  return (
    <div style={{ paddingBottom: 120 }}>
      <h1>
        Before you spend — <span className="hl">here&apos;s the market</span>
      </h1>
      <p className="sub">
        Discovering the market is always free. Below is what enriching a lead
        costs — nothing is charged until you confirm, and you choose which leads
        to enrich after Discover shows you the real count.
      </p>

      {/* Freshness callout */}
      {newCells > 0 && knownCells > 0 ? (
        <div className="callout amber section" role="status">
          <span aria-hidden="true">🕗</span>
          <div>
            <b>Mixed markets</b> — {knownCells} already mapped (real counts from
            cache), {newCells} not yet mapped (counted live on Discover — free).
          </div>
        </div>
      ) : newCells > 0 ? (
        <div className="callout amber section" role="status">
          <span aria-hidden="true">🆕</span>
          <div>
            <b>New markets</b> — none of these have been mapped yet, so we
            don&apos;t know the real business count until Discover runs (free).
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

      {/* 4 KPI cards — REAL counts only, from already-discovered cells. Never a
          guessed number: knownCells===0 shows "—" (matches the DiscoverStep
          honesty pattern), a mix shows the real known-cell sum with a note. */}
      <div className="grid g4 section">
        <StatCard
          k="Local businesses in market"
          to={localBiz}
          emDash={knownCells === 0}
          estimate={false}
          d={
            knownCells === 0
              ? "not yet mapped"
              : `${knownCells} of ${cells.length} cell${cells.length === 1 ? "" : "s"} mapped`
          }
        />
        <StatCard
          k="Have contacts"
          to={haveContactsPct}
          suffix="%"
          emDash={knownCells === 0}
          estimate={false}
          d="reachable by email/phone/social"
        />
        <StatCard
          k="Active on Google"
          to={activeGoogle}
          emDash={knownCells === 0}
          estimate={false}
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
        {knownCells === 0
          ? "No real data yet — every market here is new. Discover (free) reveals the real counts."
          : hasUnknown
            ? `Real counts from ${knownCells} already-mapped cell${knownCells === 1 ? "" : "s"}; ${newCells} more will be counted after Discover (free).`
            : "Real counts from our latest snapshot — confirmed live on Discover before you spend on enrichment."}
      </p>

      {/* Per-cell market composition — freshness + real-or-unknown business
          count only. Discovery is always free and enrich prices per lead
          (below), so this table's job is composition, not cost math. */}
      <div className="card section">
        <h2 style={{ margin: "0 0 6px" }}>Per-cell market composition</h2>
        <div className="scroll-x">
          <table className="matrix">
            <thead>
              <tr>
                <th>Market</th>
                <th>Freshness</th>
                <th>Businesses</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="biz" colSpan={3}>
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
                        {r.neverDiscovered ? "—" : r.bizCount.toLocaleString()}
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
                  {knownCells === 0
                    ? "—"
                    : hasUnknown
                      ? `${totBiz.toLocaleString()}+`
                      : totBiz.toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="note" style={{ marginTop: 10 }}>
          Businesses shown are real counts for already-mapped cells; a market
          marked &ldquo;—&rdquo; hasn&apos;t been discovered yet — Discover
          (free) reveals its real count.
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
            <span className="cr free">free</span>
          </div>
          <p className="note" style={{ margin: "2px 0 10px" }}>
            Always free — see the whole raw market before you spend anything.
          </p>
          <div className="enr-sub" style={{ paddingLeft: 0 }}>
            <span className="lbl">② Enrich — per research</span>
          </div>
          <div style={{ margin: "8px 0" }}>
            {researchRows.length > 0 ? (
              researchRows.map((r) => (
                <div className="enr-sub" key={r.family}>
                  <span className="lbl">{r.label}</span>
                  <span className="cr">
                    {r.basis === "cell"
                      ? "shared across this market"
                      : "included per lead"}
                  </span>
                </div>
              ))
            ) : (
              <p className="note">
                No enrichment research — add signals on the Goal step.
              </p>
            )}
          </div>
          <div className="enr-sub" style={{ paddingLeft: 0, fontWeight: 700 }}>
            <span className="lbl" style={{ color: "var(--ink)" }}>
              ≈{fmtCredits(enrichRate)} credits per lead you enrich
            </span>
            <span className="cr" style={{ color: "var(--ink)" }}>
              <span className="ic-coin sm" aria-hidden="true" />
              {fmtCredits(enrichRate)}
            </span>
          </div>
          {enrichCellFee > 0 ? (
            <p className="note" style={{ margin: "4px 0 0" }}>
              + {fmtCredits(enrichCellFee)} credits one-time for this
              market&apos;s ad/SERP data, shared across every lead.
            </p>
          ) : null}
          {knownCells > 0 ? (
            <p className="note" style={{ margin: "10px 0 0" }}>
              At the {totBiz.toLocaleString()} already-mapped business
              {totBiz === 1 ? "" : "es"} found so far, that&apos;s ≈
              {fmtCredits(knownEnrichTotal)} credits to enrich all of them — but
              you choose exactly which leads to enrich after Discover.
            </p>
          ) : (
            <p className="note" style={{ margin: "10px 0 0" }}>
              The exact lead count is confirmed after Discover (free) — you pay
              only for the leads you choose to enrich.
            </p>
          )}
        </div>
      </div>

      {error ? (
        <p className="callout amber section" role="alert">
          {error}
        </p>
      ) : null}

      {/* Sticky dark costbar — Discover is always free */}
      <div className="costbar">
        <div>
          <div className="big">
            <span className="ic-coin" aria-hidden="true" /> Discover{" "}
            {cells.length} market{cells.length === 1 ? "" : "s"} — free
          </div>
          <div className="small">
            Only Discover runs now, at no cost — you choose which leads to
            enrich after, ≈{fmtCredits(enrichRate)} credits each.
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
