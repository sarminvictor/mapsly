"use client";

// PreviewStep · "Before you spend — here's the market" (step 3 of 4). This is
// where Discover USED TO be its own step — it no longer is. The moment this
// screen mounts (right after Market's "Preview & credits →"), it auto-
// triggers discovery in the background: no extra click, because Discover is
// free and `runDiscoveryAction` idempotently upserts onto the same Discovery
// row for the same (agency, cells) pair, so re-mounting this screen (e.g. Back
// → Market → forward again) never double-maps a cell or double-spends real
// DfS cost — it just resumes/re-reads the same job.
//
// While the market maps, every real-number surface (the 4 KPI cards, the
// per-cell "Businesses" column, the market sample table) shows a loading
// skeleton instead of a guessed number or a flat "—", and a single
// indeterminate progress callout replaces the old "New markets — none of
// these have been mapped yet…" text block. The moment the job reaches a
// terminal status (READY/PARTIAL), the same UI repaints with the real numbers
// (via a silent re-quote — no page/step change) and the sticky bottom bar
// swaps itself from "Mapping the market…" to "Enrich →", merging in what the
// old DiscoverStep's costbar used to do. FAILED shows a clear error + retry.
//
// HONESTY · a never-discovered cell's business count is genuinely UNKNOWN —
// NEVER a guessed number, and the "still mapping" state is never confused
// with a fake percentage: the progress indicator is deliberately
// indeterminate (no invented "N of M cells" — the Discovery model only
// tracks one job-wide status, not per-cell progress). Enrichment is priced as
// a per-lead RATE (business-basis families' unit costs, summed once via
// enrichRatePerLead) + a one-time per-cell fee (cell-basis families via
// enrichCellFeeCredits) until the market is mapped, then as a real total over
// the real business count. Uses ported classes (.stat/.matrix/.costbar/
// .freshdot/.skel/.bar.indeterminate). English-only for now.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  preflightDiscoveryAction,
  runDiscoveryAction,
  type PreviewCell,
  type PreviewKpis,
} from "@/modules/discovery/actions";
import {
  fetchRawListAction,
  getDiscoverySummary,
} from "@/modules/discovery/raw-list-actions";
import {
  preflightEnrichAction,
  runEnrichAction,
} from "@/modules/discovery/enrich-actions";
import { cellKey as makeCellKey } from "@/lib/cell";
import { ENRICHMENT_PRICES } from "@/modules/cost/pricing";
import { SIG_META } from "../../goal-templates";
import {
  groupSignalsByResearch,
  researchesForSignals,
  RESEARCH_LABELS,
} from "../../researches";
import { buildDiscoverySignals } from "../../discovery-signals";
import {
  buildCellRows,
  enrichCellFeeCredits,
  enrichCreditsFor,
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
  /** The priceKey this quote was computed for — lets the auto-run effect
   *  reject a quote left over from the PREVIOUS selection during the one
   *  render between a priceKey change and the fresh quote landing (state
   *  updates are async; `quote` itself doesn't change synchronously with
   *  `priceKey`). Without this, auto-run could fire with a stale estimateId
   *  scoped to the old cells. */
  forKey: string;
  estimateId: string;
  netCredits: number;
  freshCount: number;
  refetchCount: number;
  /** Per-cell rows — REAL business counts for cells already in the DB. */
  cells: PreviewCell[];
  /** Aggregate KPI inputs (real from in-DB cells + estimate from new cells). */
  kpis: PreviewKpis;
}

interface SampleRow {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  rating: number | null;
  reviewCount: number | null;
  website: string | null;
}

type JobStatus = "PENDING" | "RUNNING" | "READY" | "PARTIAL" | "FAILED";

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
  walletCredits,
  onBack,
  onEnriching,
  onToast,
}: {
  goal: GoalState;
  cells: MarketCell[];
  walletCredits?: number;
  onBack: () => void;
  /** Called once enrichment starts — carries the discoveryId too, so the
   *  parent flow can stamp it into the URL for the Enriching step. */
  onEnriching: (info: {
    runId: string;
    leadCount: number;
    discoveryId: string;
  }) => void;
  onToast: (msg: string) => void;
}) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pricing, startPrice] = useTransition();

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

  // "What you picked" grouped by research (docs/portal-prototype.html's
  // pickedGroups pattern, ported to our REAL SIG_META.researches instead of
  // the prototype's mock signal→research mapping — see groupSignalsByResearch).
  const pickedGroups = useMemo(
    () => groupSignalsByResearch(activeSignals, families),
    [activeSignals, families],
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

  // Content key — identifies the actual cell/signal SET. Every effect below
  // that must restart on a genuine selection change (never on an unrelated
  // re-render) keys off this string instead of the array refs, which get
  // rebuilt every render.
  const priceKey = JSON.stringify({
    cells: toDiscoveryCells(cells),
    signalKeys,
    persistedSignals,
  });

  // ── Race-safety for the 3 async chains below (quote / auto-run / poll) ────
  // Every async callback captures `requestIdRef.current` at fire time and
  // checks it again after each await; a stale generation (superseded by a
  // newer selection) drops its result instead of overwriting fresher state.
  const requestIdRef = useRef(0);
  // Guards the auto-run effect so it fires exactly once per selection — keyed
  // by priceKey, reset whenever the selection changes.
  const autoRunKeyRef = useRef<string | null>(null);

  const quotePreflight = useCallback(
    async (requestId: number, opts: { resetFirst: boolean }) => {
      if (opts.resetFirst) {
        setQuote(null);
        setError(null);
      }
      const r = await preflightDiscoveryAction({
        cells: toDiscoveryCells(cells),
        signalKeys,
        signals: persistedSignals,
      });
      if (requestIdRef.current !== requestId) return null;
      if (r.status === "ok") {
        const q: Quote = {
          forKey: priceKey,
          estimateId: r.estimateId,
          netCredits: r.netCredits,
          freshCount: r.freshCount,
          refetchCount: r.refetchCount,
          cells: r.cells,
          kpis: r.kpis,
        };
        setQuote(q);
        return q;
      }
      setError(
        r.status === "invalid_input"
          ? r.message
          : `Couldn't price this (${r.status}).`,
      );
      return null;
    },
    // cells/signalKeys/persistedSignals are exactly what priceKey encodes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [priceKey],
  );

  // ── Discovery job state (was DiscoverStep's job) ──────────────────────────
  const [discoveryId, setDiscoveryId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [sampleRows, setSampleRows] = useState<SampleRow[]>([]);
  const [starting, startStarting] = useTransition();

  // 1) On a genuine selection change: bump the generation, reset everything
  // (including the discovery job — a different market needs its own run),
  // and fetch a fresh quote. `startPrice(async () => …)` mirrors the existing
  // transition pattern used elsewhere in this flow.
  useEffect(() => {
    const myId = ++requestIdRef.current;
    autoRunKeyRef.current = null;
    startPrice(async () => {
      setDiscoveryId(null);
      setJobStatus(null);
      setJobError(null);
      setSampleRows([]);
      setElapsedSec(0);
      await quotePreflight(myId, { resetFirst: true });
    });
    // priceKey is the stable content proxy for the selection; quotePreflight
    // is itself derived from the same priceKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceKey]);

  // 2) Auto-run discovery the MOMENT a quote lands for this selection — no
  // manual click, no separate step. Discovery is free; `runDiscoveryAction`
  // idempotently upserts on (agency, cellKeys), so calling it again for an
  // unchanged selection (e.g. after Back → Market → forward) safely resumes
  // the same Discovery row instead of re-mapping or double-spending.
  useEffect(() => {
    // quote.forKey !== priceKey covers the one render between a selection
    // change and the fresh quote landing, where `quote` is still the OLD
    // object (state updates aren't synchronous with the priceKey change) —
    // without this check, auto-run could fire using an estimateId scoped to
    // the previous cells.
    if (!quote || quote.forKey !== priceKey || cells.length === 0) return;
    if (autoRunKeyRef.current === priceKey) return; // already started
    autoRunKeyRef.current = priceKey;
    const myId = requestIdRef.current;
    const estimateId = quote.estimateId;
    startStarting(async () => {
      const r = await runDiscoveryAction({ estimateId });
      if (requestIdRef.current !== myId) return; // superseded
      if (r.status === "ok") {
        setDiscoveryId(r.discoveryId);
        setJobStatus("PENDING");
      } else if (r.status === "needs_requote" || r.status === "quote_expired") {
        // The quote went stale before we could auto-run — clear the guard and
        // re-quote; the next quote re-fires this effect and retries.
        autoRunKeyRef.current = null;
        await quotePreflight(myId, { resetFirst: false });
      } else {
        setJobError(`Couldn't start mapping this market (${r.status}).`);
      }
    });
  }, [quote, priceKey, cells.length, quotePreflight]);

  // 3) Poll the discovery's REAL job status once it exists — indefinitely
  // while PENDING/RUNNING (never a fixed retry cap — see the old DiscoverStep
  // honesty rule this replaces). On terminal success, silently re-quote (picks
  // up the now-real per-cell counts + KPIs) and pull a small business sample.
  //
  // `cancelled` (not just the shared requestIdRef) is the authority for THIS
  // effect instance: React can re-run this effect (e.g. `quotePreflight`'s
  // identity changing on a fresh selection) a tick before `discoveryId` itself
  // has been reset to null by effect 1's async callback, so a lone
  // requestIdRef check could momentarily still "match" for a poll loop that's
  // actually chasing a superseded discoveryId. The cleanup below always runs
  // before a new instance starts, so `cancelled` is a reliable per-instance
  // guard regardless of that ordering.
  useEffect(() => {
    if (!discoveryId) return;
    const myId = requestIdRef.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    async function poll() {
      const s = await getDiscoverySummary({ discoveryId });
      if (cancelled || requestIdRef.current !== myId) return;
      setElapsedSec(Math.round((Date.now() - startedAt) / 1000));
      if (s.status !== "ok") {
        timer = setTimeout(poll, 3000); // transient read error — keep trying
        return;
      }
      setJobStatus(s.summary.jobStatus);
      if (
        s.summary.jobStatus === "PENDING" ||
        s.summary.jobStatus === "RUNNING"
      ) {
        timer = setTimeout(poll, 3000);
        return;
      }
      if (
        s.summary.jobStatus === "READY" ||
        s.summary.jobStatus === "PARTIAL"
      ) {
        await quotePreflight(myId, { resetFirst: false });
        if (cancelled) return;
        const raw = await fetchRawListAction({ discoveryId });
        if (cancelled || requestIdRef.current !== myId) return;
        if (raw.status === "ok") {
          setSampleRows(
            raw.rows.slice(0, 6).map((row) => ({
              id: row.id,
              name: row.name,
              category: row.category,
              city: row.city,
              rating: row.rating,
              reviewCount: row.reviewCount,
              website: row.website,
            })),
          );
        }
      }
      // FAILED → nothing more to fetch; jobStatus alone drives the failed UI.
    }
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [discoveryId, quotePreflight]);

  const jobFailed = jobStatus === "FAILED";
  const mapped = jobStatus === "READY" || jobStatus === "PARTIAL";
  const stillMapping = !mapped && !jobFailed;

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
  // count is unknown, not zero, so it must never be summed into a total. Once
  // `mapped`, every requested cell has been through the run, so this becomes
  // the real market total.
  const totBiz = useMemo(
    () =>
      rows
        .filter((r) => !r.neverDiscovered)
        .reduce((s, r) => s + r.bizCount, 0),
    [rows],
  );

  // The per-lead enrich rate + one-time cell fee — both knowable WITHOUT a
  // business count (see enrichRatePerLead/enrichCellFeeCredits docs). This is
  // what the "What it costs" card shows before the market is mapped.
  const enrichRate = useMemo(() => enrichRatePerLead(families), [families]);
  const enrichCellFee = useMemo(
    () => enrichCellFeeCredits(families, cells.length),
    [families, cells.length],
  );
  // The REAL enrich total once mapped; an honest per-lead-rate projection
  // (over known cells only) before that.
  const knownEnrichTotal = totBiz * enrichRate + enrichCellFee;
  const enrichCredits = mapped
    ? enrichCreditsFor(families, totBiz, cells.length)
    : knownEnrichTotal;
  const enrichMinutes = mapped ? Math.max(2, Math.round(totBiz / 70)) : 0;
  const haveCredits = walletCredits == null || enrichCredits <= walletCredits;

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
  const localBiz = kpis ? kpis.localBusinessesReal : totBiz;
  const activeGoogle = kpis ? kpis.activeOnGoogleReal : 0;
  const matchReal = kpis ? kpis.matchSignalsReal : 0;
  const haveContactsPct = kpis
    ? kpis.localBusinessesReal > 0
      ? Math.round((kpis.haveContactsReal / kpis.localBusinessesReal) * 100)
      : 0
    : 0;

  const knownCells = useMemo(
    () => (quote ? quote.cells.filter((c) => !c.neverDiscovered).length : 0),
    [quote],
  );

  // ── Enrich (was DiscoverStep's enrich()) ──────────────────────────────────
  const [runningEnrich, startRunEnrich] = useTransition();
  const [runError, setRunError] = useState<string | null>(null);
  const cellKeys = useMemo(
    () => cells.map((c) => makeCellKey(c.categorySlug, c.metroSlug, c.country)),
    [cells],
  );

  function retryMapping() {
    setJobError(null);
    setJobStatus(null);
    setDiscoveryId(null);
    autoRunKeyRef.current = null;
    const myId = ++requestIdRef.current;
    startPrice(async () => {
      await quotePreflight(myId, { resetFirst: true });
    });
  }

  function enrich() {
    setRunError(null);
    if (!mapped || !discoveryId) return;
    if (!haveCredits) {
      onToast("Not enough credits — add credits to enrich");
      return;
    }
    startRunEnrich(async () => {
      const pre = await preflightEnrichAction({
        cellKeys,
        enrichments: families,
      });
      if (pre.status !== "ok") {
        setRunError(
          pre.status === "invalid_input"
            ? pre.message
            : `Couldn't price enrichment (${pre.status}).`,
        );
        return;
      }
      const run = await runEnrichAction({ estimateId: pre.estimateId });
      if (run.status === "ok") {
        onEnriching({ runId: run.runId, leadCount: totBiz, discoveryId });
      } else if (run.status === "needs_approval") {
        setRunError("This enrichment is over the auto limit — needs approval.");
      } else if (run.status === "insufficient_credits") {
        setRunError("Not enough credits — add credits to run this.");
        onToast("Not enough credits");
      } else if (
        run.status === "needs_requote" ||
        run.status === "quote_expired"
      ) {
        setRunError("The quote changed — try Enrich again.");
      } else {
        setRunError(`Couldn't start enrichment (${run.status}).`);
      }
    });
  }

  return (
    <div style={{ paddingBottom: 120 }}>
      <h1>
        {mapped ? (
          <>
            Found{" "}
            <span className="hl">
              {totBiz.toLocaleString()} local businesses
            </span>
            {cells.length > 1 ? ` across ${cells.length} markets` : ""}
          </>
        ) : jobFailed ? (
          <span className="hl">Mapping failed</span>
        ) : (
          <>
            Before you spend —{" "}
            <span className="hl">here&apos;s the market</span>
          </>
        )}
      </h1>
      <p className="sub">
        {mapped
          ? "This is the real market we found on Google & Maps. Below is what enriching a lead costs — nothing is charged until you confirm."
          : "Mapping the market now — it's free and runs automatically. Below is what enriching a lead costs; nothing is charged until you confirm."}
      </p>

      {/* Job-lifecycle callout — replaces the old flat "New markets… " text
          with an honest indeterminate progress indicator while mapping. */}
      {jobFailed ? (
        <div className="callout amber section" role="alert">
          <span aria-hidden="true">⚠️</span>
          <div style={{ flex: 1 }}>
            <b>This market couldn&apos;t be mapped.</b> No credits were spent.{" "}
            <button
              type="button"
              className="btn sm"
              style={{ marginLeft: 6 }}
              onClick={retryMapping}
            >
              Try again
            </button>
          </div>
        </div>
      ) : stillMapping ? (
        <div className="callout section" role="status">
          <span aria-hidden="true">🗺️</span>
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 8 }}>
              <b>
                Mapping {cells.length} market{cells.length === 1 ? "" : "s"}
              </b>{" "}
              — usually under 2 minutes.{" "}
              {elapsedSec > 0 ? `${elapsedSec}s elapsed. ` : ""}
              You can leave this page — we keep working and pick up where you
              left off.
            </div>
            <div
              className="bar indeterminate"
              role="progressbar"
              aria-label="Mapping the market"
            >
              <i />
            </div>
          </div>
        </div>
      ) : (
        <div className="callout green section" role="status">
          <span aria-hidden="true">✅</span>
          <div>
            <b>Market mapped</b> — every number below is real.
          </div>
        </div>
      )}

      {jobError ? (
        <div className="callout amber section" role="alert">
          <span aria-hidden="true">⚠️</span>
          <div style={{ flex: 1 }}>{jobError}</div>
        </div>
      ) : null}

      {/* 4 KPI cards — REAL counts once mapped; a loading skeleton (never a
          guessed number, never a flat "—") while the market is still mapping. */}
      <div className="grid g4 section">
        <StatCard
          k="Local businesses in market"
          to={localBiz}
          loading={stillMapping && knownCells === 0}
          dash={jobFailed && knownCells === 0}
          d={stillMapping ? "mapping…" : "the whole market"}
        />
        <StatCard
          k="Have contacts"
          to={haveContactsPct}
          suffix="%"
          loading={stillMapping && knownCells === 0}
          dash={jobFailed && knownCells === 0}
          d="reachable by email/phone/social"
        />
        <StatCard
          k="Active on Google"
          to={activeGoogle}
          loading={stillMapping && knownCells === 0}
          dash={jobFailed && knownCells === 0}
          d="recent reviews, open now"
        />
        <StatCard
          k="Match your signals"
          to={matchReal}
          loading={stillMapping && knownCells === 0}
          dash={jobFailed && knownCells === 0}
          indigo
          d={`your ${sigCount} signal${sigCount === 1 ? "" : "s"} applied`}
        />
      </div>

      {/* Per-cell market composition — freshness + real business count (or a
          skeleton while that specific cell is still being mapped). */}
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
                  // Three distinct states, never conflated: still being
                  // mapped (skeleton), the run failed so this cell was never
                  // actually checked ("—", not a fake 0), or a real count.
                  const rowLoading = r.neverDiscovered && stillMapping;
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
                        {rowLoading ? (
                          <span
                            className="skel"
                            style={{ width: 40, display: "inline-block" }}
                          />
                        ) : r.neverDiscovered ? (
                          "—"
                        ) : (
                          r.bizCount.toLocaleString()
                        )}
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
                  {stillMapping && knownCells === 0 ? (
                    <span
                      className="skel"
                      style={{ width: 50, display: "inline-block" }}
                    />
                  ) : (
                    totBiz.toLocaleString()
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Sample of the market — a handful of real rows once mapped (was
          DiscoverStep's raw-market table). Hidden until there's something
          real to show; a skeleton while the job is in flight. */}
      {discoveryId ? (
        <div className="card section">
          <h2 style={{ margin: "0 0 6px" }}>
            Sample of the market{" "}
            <span className="note">
              Raw discovery data — your signals apply after enrichment.
            </span>
          </h2>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Category</th>
                  <th>Rating</th>
                  <th>Reviews</th>
                  <th>Website</th>
                </tr>
              </thead>
              <tbody>
                {stillMapping ? (
                  [0, 1, 2].map((i) => (
                    <tr key={i} className="skelrow">
                      <td colSpan={5}>
                        <span className="skel" style={{ width: "100%" }} />
                      </td>
                    </tr>
                  ))
                ) : jobFailed ? (
                  <tr>
                    <td colSpan={5} className="note" style={{ padding: 24 }}>
                      This market couldn&apos;t be mapped.
                    </td>
                  </tr>
                ) : sampleRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="note" style={{ padding: 24 }}>
                      No businesses found in this market. Try a different
                      category or city.
                    </td>
                  </tr>
                ) : (
                  sampleRows.map((r) => (
                    <tr key={r.id}>
                      <td className="biz">
                        {r.name}
                        {r.city ? <div className="addr">{r.city}</div> : null}
                      </td>
                      <td>{r.category ?? "—"}</td>
                      <td>
                        {r.rating != null ? `★ ${r.rating.toFixed(1)}` : "—"}
                      </td>
                      <td>{r.reviewCount?.toLocaleString() ?? "—"}</td>
                      <td>{r.website ? "✓" : "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {mapped ? (
            <p className="note" style={{ marginTop: 10 }}>
              Showing {sampleRows.length} of {totBiz.toLocaleString()} · enrich
              to apply your signals and reveal contacts.
            </p>
          ) : null}
        </div>
      ) : null}

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
            {pickedGroups.length === 0 ? (
              <p className="note" style={{ margin: "8px 0 0" }}>
                No signals yet — add some on the Goal step.
              </p>
            ) : (
              pickedGroups.map((g) => (
                <div className="rgroup" key={g.key}>
                  <div className="rhead">
                    <b>{g.label}</b> <span className="src">· {g.source}</span>
                  </div>
                  <div className="rpills">
                    {g.titles.map((title, i) => (
                      <span className="pill indigo" key={`${g.key}-${i}`}>
                        {title}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
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
            Always free — runs automatically, before you spend anything.
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
          {mapped ? (
            <p className="note" style={{ margin: "10px 0 0" }}>
              For all {totBiz.toLocaleString()} business
              {totBiz === 1 ? "" : "es"} found, that&apos;s ≈
              {fmtCredits(enrichCredits)} credits to enrich everything — but you
              choose exactly which leads to enrich next.
            </p>
          ) : knownCells > 0 ? (
            <p className="note" style={{ margin: "10px 0 0" }}>
              At the {totBiz.toLocaleString()} already-mapped business
              {totBiz === 1 ? "" : "es"} found so far, that&apos;s ≈
              {fmtCredits(knownEnrichTotal)} credits — the exact total updates
              once the rest of the market finishes mapping.
            </p>
          ) : (
            <p className="note" style={{ margin: "10px 0 0" }}>
              The exact lead count is confirmed the moment mapping finishes —
              you pay only for the leads you choose to enrich.
            </p>
          )}
        </div>
      </div>

      {error ? (
        <p className="callout amber section" role="alert">
          {error}
        </p>
      ) : null}
      {runError ? (
        <p className="callout amber section" role="alert">
          {runError}
        </p>
      ) : null}

      {/* Sticky dark costbar — swaps from "Mapping…" to "Enrich →" itself,
          the moment the market is real. No separate Discover step/click. */}
      <div className="costbar">
        <div>
          <div className="big">
            <span className="ic-coin" aria-hidden="true" />{" "}
            {jobFailed ? (
              "Mapping failed"
            ) : mapped ? (
              <>
                Enrich {totBiz.toLocaleString()} business
                {totBiz === 1 ? "" : "es"}
                <span className="small">
                  {" "}
                  · ~{fmtCredits(enrichCredits)} credits (
                  {fmtCredits(enrichRate)}/lead)
                </span>
              </>
            ) : (
              <>Mapping the market…{elapsedSec > 0 ? ` ${elapsedSec}s` : ""}</>
            )}
          </div>
          <div className="small">
            {jobFailed
              ? "This market couldn't be mapped — no credits were spent. Try again above."
              : !mapped
                ? "Discovery is free and runs automatically — enrichment unlocks the moment the market is mapped."
                : haveCredits
                  ? `We apply your ${sigCount} signal${sigCount === 1 ? "" : "s"} to the enriched data and reveal your matches + contacts. ~${enrichMinutes} min. You can close this page — we keep working and email you.`
                  : `Not enough credits — this needs ~${fmtCredits(enrichCredits)}, you have ${fmtCredits(walletCredits ?? 0)}. Add credits to run it.`}
          </div>
        </div>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onBack}>
          ← Back
        </button>
        <button
          type="button"
          className="btn primary big"
          disabled={
            jobFailed || !mapped || runningEnrich || starting || pricing
          }
          onClick={enrich}
        >
          {jobFailed
            ? "Failed"
            : !mapped
              ? "Mapping…"
              : runningEnrich
                ? "Starting…"
                : haveCredits
                  ? "Enrich →"
                  : "Add credits →"}
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
  loading,
  dash,
}: {
  k: string;
  to: number;
  suffix?: string;
  d: string;
  indigo?: boolean;
  /** Show a shimmer skeleton instead of the number — this cell hasn't been
   *  mapped yet, so any number here would be a guess. */
  loading?: boolean;
  /** Show "—" instead of the number — the run failed, so this was never
   *  actually checked. Never render 0 for "unknown"; 0 means a real zero. */
  dash?: boolean;
}) {
  const v = useCountUp(to);
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div
        className="v"
        style={indigo ? { color: "var(--indigo)" } : undefined}
      >
        {loading ? (
          <span
            className="skel"
            style={{ width: 56, height: 22, display: "inline-block" }}
          />
        ) : dash ? (
          "—"
        ) : (
          <>
            {v.toLocaleString()}
            {suffix ?? ""}
          </>
        )}
      </div>
      <div className="d">{d}</div>
    </div>
  );
}
