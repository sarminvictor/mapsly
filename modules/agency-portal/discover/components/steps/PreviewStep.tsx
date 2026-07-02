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
import { countFilteredMarketAction } from "@/modules/discovery/market-filter-actions";
import { otherAgenciesOnCellsAction } from "@/modules/discovery/collision-actions";
import { cellKey as makeCellKey } from "@/lib/cell";
import { Icon } from "@/components/agency/Icon";
import {
  ENRICHMENT_PRICES,
  enrichmentNeedsWebsite,
  type EnrichmentType,
} from "@/modules/cost/pricing";
import { usdToCredits } from "@/modules/cost/estimate";
import { SIG_META } from "../../goal-templates";
import {
  groupSignalsByResearch,
  researchesForSignals,
  resolveResearches,
  RESEARCH_LABELS,
  RESEARCH_SOURCES,
} from "../../researches";
import { buildDiscoverySignals } from "../../discovery-signals";
import {
  buildCellRows,
  classifyMarketSize,
  enrichCellFeeCredits,
  enrichCreditsFor,
  enrichableCountForCell,
  enrichRatePerLead,
  fmtCredits,
  freshDotClass,
  marketFiltersActive,
  OVERSIZED_MARKET_THRESHOLD,
  THIN_MARKET_THRESHOLD,
  toDiscoveryCells,
  type GoalState,
  type MarketCell,
  type MarketFilters,
  type QuoteCell,
} from "../../flow-types";
import { CreditWallSheet } from "../CreditWallSheet";
import { PreEnrichFilters } from "./PreEnrichFilters";
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
  locale,
  extraEnrichTypes = [],
  onBack,
  onEnriching,
}: {
  goal: GoalState;
  cells: MarketCell[];
  walletCredits?: number;
  /** Locale for the credit-wall sheet's checkout return URL (WP2-3). */
  locale: string;
  /**
   * WP5-3 · enrichment families pre-seeded by the `?enrich=` deep link
   * (coverage CTAs / locked columns). Unioned into the goal-derived research
   * set (dependency chains resolved), so the deep-linked family is quoted +
   * run alongside what the signals need.
   */
  extraEnrichTypes?: EnrichmentType[];
  onBack: () => void;
  /** Called once enrichment starts — carries the discoveryId too, so the
   *  parent flow can stamp it into the URL for the Enriching step. */
  onEnriching: (info: {
    runId: string;
    leadCount: number;
    discoveryId: string;
  }) => void;
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
  // WP5-3 · deep-linked `?enrich=` families are unioned in (deps re-resolved)
  // so an "enrich contacts →" link from the workbench actually prices contacts.
  const extraKey = extraEnrichTypes.join(",");
  const families = useMemo(
    () =>
      resolveResearches([
        ...researchesForSignals(activeSignals),
        ...extraEnrichTypes,
      ]),
    // extraKey is the content proxy for extraEnrichTypes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSignals, extraKey],
  );

  // A site-based goal already excludes website-less businesses from the enrich
  // scope, so the pre-enrich "Website" filter chip would be a no-op — hide it.
  const goalNeedsWebsite = useMemo(
    () => enrichmentNeedsWebsite(families),
    [families],
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
        goalName: goal.name,
        goalBase: goal.base,
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

  // ── WP2-2 / WP2-3 per-selection state ─────────────────────────────────────
  // `pickedN` — the user's lead cap (null = untouched → wallet-fitted
  // default). `creditWall` — non-null renders the inline upgrade sheet
  // (WP2-3) in place of the old dead-end toast; `needCredits` is the server
  // quote when we have one, else the display estimate for the attempted run.
  // Declared up here (before effect 1) because the selection-change reset
  // clears both; the derived affordable/selected math lives further down with
  // the rest of the enrich-credit derivations.
  const [pickedN, setPickedN] = useState<number | null>(null);
  const [creditWall, setCreditWall] = useState<{ needCredits: number } | null>(
    null,
  );

  // ── WP5-4 · free pre-enrich filters ───────────────────────────────────────
  // The filter object threads into the preflight (server-side scope resolve),
  // and the surviving count is server-counted (never client math). Both are
  // per-selection state — effect 1 resets them on a market change.
  const [marketFilters, setMarketFilters] = useState<MarketFilters>({});
  const [filteredCount, setFilteredCount] = useState<{
    forKey: string;
    total: number;
    enrichable: number;
  } | null>(null);
  const filtersActive = marketFiltersActive(marketFilters);
  const filterKey = JSON.stringify(marketFilters);

  // ── Discovery job state (was DiscoverStep's job) ──────────────────────────
  const [discoveryId, setDiscoveryId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [liveCount, setLiveCount] = useState(0);
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
      setLiveCount(0);
      // A different market resets the lead cap + closes the credit wall —
      // both are per-selection state (declared below with the WP2-2 block).
      setPickedN(null);
      setCreditWall(null);
      // WP5-4 · filters are per-selection too — a new market starts unfiltered.
      setMarketFilters({});
      setFilteredCount(null);
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
        timer = setTimeout(poll, 2000); // transient read error — keep trying
        return;
      }
      setJobStatus(s.summary.jobStatus);
      // The REAL count of businesses persisted so far — climbs live as the
      // worker inserts rows (getDiscoverySummary counts them). This is the
      // honest progress signal on the mapping screen, not a fake percentage.
      setLiveCount(s.summary.total);
      if (
        s.summary.jobStatus === "PENDING" ||
        s.summary.jobStatus === "RUNNING"
      ) {
        // Poll faster while mapping so the count climbs visibly.
        timer = setTimeout(poll, 2000);
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
        websiteBizCount: c.websiteBizCount,
        neverDiscovered: c.neverDiscovered,
      });
    }
    return m;
  }, [quote]);

  const rows = useMemo(
    () => (quote ? buildCellRows(cells, quoteByKey) : []),
    [quote, cells, quoteByKey],
  );

  const knownRows = useMemo(
    () => rows.filter((r) => !r.neverDiscovered),
    [rows],
  );

  // Aggregate business count = sum of ONLY the known (already-discovered)
  // cells' real counts. Never-discovered cells contribute nothing here — their
  // count is unknown, not zero. Once `mapped`, every requested cell has been
  // through the run, so this becomes the real market total.
  const totBiz = useMemo(
    () => knownRows.reduce((s, r) => s + r.bizCount, 0),
    [knownRows],
  );

  // The ENRICHABLE count — website-havers only when a selected research needs a
  // live site (else all). This is what the enrich cost + costbar price, since
  // Lighthouse/contacts/tech/etc. can't run on a website-less listing.
  const enrichableTotal = useMemo(
    () =>
      knownRows.reduce((s, r) => s + enrichableCountForCell(r, families), 0),
    [knownRows, families],
  );
  // How many mapped leads are excluded from enrichment for lack of a website —
  // surfaced honestly so the count drop ("731 found → 613 enrichable") isn't a
  // silent mystery.
  const notEnrichable = totBiz - enrichableTotal;

  // ── WP7-13 · statistical-edge market notes ────────────────────────────────
  // Classify each DISCOVERED cell so the vs-cell claim never lies at the edges:
  //   - thin cells (< 25 businesses) → the workbench shows absolute benchmarks,
  //     not percentiles (too few rows for an honest distribution);
  //   - oversized cells (>= 2000) → suggest narrowing by neighborhood / radius.
  const thinCells = useMemo(
    () => knownRows.filter((r) => classifyMarketSize(r.bizCount) === "thin"),
    [knownRows],
  );
  const oversizedCells = useMemo(
    () =>
      knownRows.filter((r) => classifyMarketSize(r.bizCount) === "oversized"),
    [knownRows],
  );

  // ── WP5-4 · the EFFECTIVE enrichable count under the active filters ──────
  // The server count is authoritative for the filtered set; while it's in
  // flight (or filters are off) we fall back to the whole-market enrichable
  // count. Keyed so a stale count for OLD filters/selection is never used.
  const countKey = `${priceKey}|${families.join(",")}|${filterKey}`;
  const filteredForKey =
    filteredCount && filteredCount.forKey === countKey ? filteredCount : null;
  const effEnrichable =
    filtersActive && filteredForKey != null
      ? filteredForKey.enrichable
      : enrichableTotal;

  // Live-count the surviving set server-side (debounced) whenever the filters
  // are active on a mapped market. Uses the SAME rawListWhere the preflight
  // resolves scope with, so the number shown is the set that gets priced.
  useEffect(() => {
    if (!mapped || !discoveryId || !filtersActive) return;
    const myKey = countKey;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        const r = await countFilteredMarketAction({
          discoveryId,
          filters: marketFilters,
          enrichments: families,
        });
        if (cancelled) return;
        if (r.status === "ok") {
          setFilteredCount({
            forKey: myKey,
            total: r.total,
            enrichable: r.enrichable,
          });
        }
      })();
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // countKey is the content proxy for marketFilters + families + selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapped, discoveryId, filtersActive, countKey]);

  // The per-lead enrich rate + one-time cell fee — both knowable WITHOUT a
  // business count (see enrichRatePerLead/enrichCellFeeCredits docs).
  const enrichRate = useMemo(() => enrichRatePerLead(families), [families]);
  const enrichCellFee = useMemo(
    () => enrichCellFeeCredits(families, cells.length),
    [families, cells.length],
  );
  // The REAL enrich total once mapped (over the ENRICHABLE subset); an honest
  // per-lead-rate projection over known cells before that.
  const knownEnrichTotal = enrichableTotal * enrichRate + enrichCellFee;
  const enrichCredits = mapped
    ? enrichCreditsFor(families, enrichableTotal, cells.length)
    : knownEnrichTotal;

  // ── WP2-2 · wallet-capped "Enrich your best N" (derived math) ─────────────
  // Default N = min(affordable, enrichable): everything when the wallet
  // covers it, else the biggest run the balance can fund — never a dead end.
  // The one-time cell fee comes off the top of the budget math because it's
  // charged once regardless of N (without that, the default could still
  // quote above the balance). N is reducible even when the wallet covers
  // everything — spend control. ALL of this is display math: the committed
  // number is re-quoted server-side over the sliced subset (preflight
  // `topN`), never client math. (`pickedN`/`creditWall` state is declared
  // above effect 1, which resets both on a selection change.)
  // WP5-4 · all best-N math runs over the FILTERED enrichable set when
  // filters are active (filters first, then top-N within the filtered set).
  const affordableN = useMemo(() => {
    if (walletCredits == null) return effEnrichable;
    if (enrichRate <= 0) {
      // Cell-fee-only goals (ads/SERP): N doesn't move the price.
      return walletCredits >= enrichCellFee ? effEnrichable : 0;
    }
    return Math.min(
      effEnrichable,
      Math.max(0, Math.floor((walletCredits - enrichCellFee) / enrichRate)),
    );
  }, [walletCredits, enrichRate, enrichCellFee, effEnrichable]);
  const selectedN = Math.max(
    0,
    Math.min(pickedN ?? affordableN, effEnrichable),
  );
  const capped = mapped && selectedN < effEnrichable;
  // Display estimate for the CURRENT selection (server re-quotes on Enrich).
  const selectedCredits = mapped
    ? enrichCreditsFor(families, selectedN, cells.length)
    : enrichCredits;
  // The smallest viable run (best 1 lead) — what the credit wall quotes when
  // even one lead doesn't fit the balance.
  const minRunCredits = enrichRate + enrichCellFee;
  const affordableCredits = mapped
    ? enrichCreditsFor(families, affordableN, cells.length)
    : 0;
  const enrichMinutes = mapped ? Math.max(2, Math.round(selectedN / 70)) : 0;
  const haveCredits = walletCredits == null || selectedCredits <= walletCredits;

  // The "② Enrich" card's per-research breakdown (matches the prototype's
  // split-by-research design) — one row per family the active signals need,
  // labeled via RESEARCH_LABELS, with its REAL per-cell/whole-market credit
  // cost once mapped.
  const researchRows = useMemo(
    () =>
      families.map((f) => {
        const basis = ENRICHMENT_PRICES[f].unit;
        const units = basis === "cell" ? cells.length : enrichableTotal;
        return {
          family: f,
          label: RESEARCH_LABELS[f],
          basis,
          credits: enrichCreditsFor([f], enrichableTotal, cells.length),
          units,
        };
      }),
    [families, enrichableTotal, cells.length],
  );

  const kpis = quote?.kpis ?? null;
  const localBiz = kpis ? kpis.localBusinessesReal : totBiz;
  // Honest market-completeness signal: DfS's real total_count vs what we
  // actually mapped (capped at 3,000/cell). When the real market is materially
  // larger, we mapped the "top N" — don't claim "the whole market". A small
  // slack absorbs default-exclusion gaps so we never false-flag a complete pull.
  const totalAvailable = kpis?.totalAvailableReal ?? null;
  const marketCapped =
    totalAvailable != null &&
    totalAvailable > Math.max(localBiz + 50, localBiz * 1.02);
  const activeGoogle = kpis ? kpis.activeOnGoogleReal : 0;
  // "Match your signals": the EXACT flagged-finding count once enrichment has
  // run (matchSignalsReal > 0), else the discovery-phase "~N passing so-far"
  // estimate. `null` matchSoFar → "—" ("computed after enrichment").
  const matchExact = kpis ? kpis.matchSignalsReal : 0;
  const matchSoFar = kpis ? kpis.matchSoFarReal : null;
  const matchIsEstimate = matchExact === 0;
  const matchValue = matchExact > 0 ? matchExact : matchSoFar;
  const haveWebsitePct = kpis
    ? kpis.localBusinessesReal > 0
      ? Math.round((kpis.haveWebsiteReal / kpis.localBusinessesReal) * 100)
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

  // ── WP6-15 · lead-collision nudge · "N other agencies track this market" ────
  // An honesty + scarcity signal, not a "same list" claim: overlapping markets
  // never yield verbatim openers because touch pain-hooks are diversified per
  // agency (modules/outreach/first-touch.ts orderPains). Fetched once per market
  // selection (bounded server count over Discovery.cellKeys overlap).
  const [otherAgencies, setOtherAgencies] = useState<number | null>(null);
  const collisionKey = cellKeys.join(",");
  useEffect(() => {
    if (cells.length === 0) return;
    let live = true;
    void (async () => {
      const res = await otherAgenciesOnCellsAction(toDiscoveryCells(cells));
      if (!live) return;
      setOtherAgencies(res.status === "ok" ? res.otherAgencies : null);
    })();
    return () => {
      live = false;
    };
    // collisionKey is the content proxy for the selected cells.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collisionKey, cells.length]);

  // ── WP4-6 · NET price + fresh-cache savings ───────────────────────────────
  // The client display math (enrichCreditsFor) is a GROSS estimate — it can't
  // see which units are already fresh (served from cache at $0). The server
  // preflight returns the honest NET (fresh-adjusted) credits + the USD saved
  // from the cache. We quote it reactively (debounced) for the CURRENT selection
  // so the card + costbar show the real "you'll pay X · Y saved from fresh
  // cache" — and the wallet gate reads NET, not gross. We also reuse the quote's
  // estimateId on the Enrich click when it still matches (no double-quote).
  const [netQuote, setNetQuote] = useState<{
    /** The selection (cells + signals) this quote priced — a change invalidates
     *  it so a stale quote can't be reused after the user edits the market. */
    forKey: string;
    forN: number;
    netCredits: number;
    freshCredits: number;
    estimateId: string;
  } | null>(null);
  // A monotonic token rejects a stale debounced quote landing after the user
  // moved the slider again.
  const netQuoteToken = useRef(0);
  useEffect(() => {
    // Only meaningful once the market is mapped + there's an enrichable subset.
    // (No synchronous setState here — a stale netQuote can't match `selectedN`
    // in the derivation below, so it's simply ignored; we never clear in the
    // effect body, per react-hooks/set-state-in-effect.)
    if (!mapped || effEnrichable <= 0 || selectedN <= 0) return;
    const n = selectedN;
    const token = ++netQuoteToken.current;
    const t = window.setTimeout(() => {
      void (async () => {
        const pre = await preflightEnrichAction({
          cellKeys,
          enrichments: families,
          // WP5-4 · the active filters ride the quote so the server resolves
          // the SAME filtered set it will hold credits for + fan out.
          ...(filtersActive ? { filters: marketFilters } : {}),
          ...(n < effEnrichable ? { topN: n } : {}),
        });
        if (token !== netQuoteToken.current) return; // superseded
        if (pre.status === "ok") {
          setNetQuote({
            forKey: countKey,
            forN: n,
            netCredits: pre.netCredits,
            freshCredits: usdToCredits(pre.freshHitUsd),
            estimateId: pre.estimateId,
          });
        }
      })();
    }, 450);
    return () => window.clearTimeout(t);
    // countKey encodes priceKey + families + filters (the quote's real inputs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapped, effEnrichable, selectedN, cellKeys, families, countKey]);

  // The NET quote for the CURRENT selection (null while a debounce is pending or
  // the selection moved — stale quotes are ignored by the forKey + forN guard).
  // netCredits is the fresh-adjusted price actually held.
  const netForSelection =
    netQuote && netQuote.forKey === countKey && netQuote.forN === selectedN
      ? netQuote
      : null;
  const netCredits = netForSelection?.netCredits ?? null;
  const freshSaved = netForSelection?.freshCredits ?? 0;
  // WP4-6 · gate the wallet on NET (not the gross display math): a run that's
  // mostly-fresh can cost far less than enrichCreditsFor suggests.
  const haveCreditsNet =
    walletCredits == null || netCredits == null || netCredits <= walletCredits;
  // The affordability the UI shows: the NET gate once the server quote lands,
  // else the gross estimate while it's in flight.
  const canAfford = netCredits != null ? haveCreditsNet : haveCredits;

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
    setCreditWall(null);
    if (!mapped || !discoveryId) return;
    // Credit wall (WP2-3) — client pre-check only; the server re-checks
    // authoritatively below. Opens the inline upgrade sheet (never a toast):
    // either nothing enrichable fits the balance, or the picked N overshoots.
    // WP4-6 · gate on the NET quote when we have it (a mostly-fresh run can be
    // affordable even when the gross display math says it isn't); fall back to
    // the gross estimate only while the net quote is still in flight.
    const affordable = netCredits != null ? haveCreditsNet : haveCredits;
    if (selectedN <= 0 || !affordable) {
      setCreditWall({
        needCredits:
          selectedN > 0 ? (netCredits ?? selectedCredits) : minRunCredits,
      });
      return;
    }
    startRunEnrich(async () => {
      // WP4-6 · reuse the debounced NET quote's estimateId when it still
      // matches this exact selection (no redundant re-quote); else quote now.
      let estimateId: string;
      let netCreditsQuoted: number;
      if (netForSelection && netForSelection.forN === selectedN) {
        estimateId = netForSelection.estimateId;
        netCreditsQuoted = netForSelection.netCredits;
      } else {
        const pre = await preflightEnrichAction({
          cellKeys,
          enrichments: families,
          // WP5-4 · filters first — the server resolves the filtered set…
          ...(filtersActive ? { filters: marketFilters } : {}),
          // WP2-2 · …then cap to the picked best-N within it. The server
          // slices reviewCount-desc (workbench sort) and quotes THAT subset —
          // committed number is server-authoritative, never client math.
          // Omitted for a full run so the server resolves the whole set.
          ...(capped ? { topN: selectedN } : {}),
        });
        if (pre.status !== "ok") {
          setRunError(
            pre.status === "invalid_input"
              ? pre.message
              : `Couldn't price enrichment (${pre.status}).`,
          );
          return;
        }
        estimateId = pre.estimateId;
        netCreditsQuoted = pre.netCredits;
      }
      // Server-authoritative affordability: the REAL (NET) quote — fresh units
      // make it cheaper than the gross display math — against the wallet.
      if (walletCredits != null && netCreditsQuoted > walletCredits) {
        setCreditWall({ needCredits: netCreditsQuoted });
        return;
      }
      const run = await runEnrichAction({ estimateId });
      if (run.status === "ok") {
        onEnriching({
          runId: run.runId,
          // Capped → the picked N; filtered → the surviving set; else the
          // whole mapped market.
          leadCount: capped
            ? selectedN
            : filtersActive
              ? effEnrichable
              : totBiz,
          discoveryId,
        });
      } else if (run.status === "insufficient_credits") {
        // Wallet moved between quote and hold — same sheet, server's number.
        setCreditWall({ needCredits: run.netCredits });
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

      {/* WP6-15 · lead-collision positioning — an honest scarcity nudge. Shown
          only when other agencies actually overlap this market. Framed as
          honesty (not FUD): touches are diversified per agency, so overlapping
          markets never send verbatim-identical openers. */}
      {otherAgencies != null && otherAgencies > 0 ? (
        <p className="note" role="status" style={{ marginTop: -4 }}>
          {otherAgencies === 1
            ? "1 other agency is already tracking this market"
            : `${otherAgencies.toLocaleString()} other agencies are already tracking this market`}
          {" — "}
          get in early. Your outreach stays distinct: Mapsly rotates each
          agency&rsquo;s pitch angle so no two send the same opener.
        </p>
      ) : null}

      {/* Job-lifecycle callout — replaces the old flat "New markets… " text
          with an honest indeterminate progress indicator while mapping. */}
      {jobFailed ? (
        <div className="callout amber section" role="alert">
          <Icon name="warning" size={16} style={{ flex: "none" }} />
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
          <Icon name="search" size={16} style={{ flex: "none" }} />
          <div style={{ flex: 1 }}>
            <div
              style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}
              aria-live="polite"
            >
              {liveCount > 0
                ? `Found ${liveCount.toLocaleString()} local businesses so far…`
                : `Querying Google Maps across ${cells.length} market${cells.length === 1 ? "" : "s"}…`}
            </div>
            <div className="note" style={{ marginBottom: 8 }}>
              Pulling every business listing in your{" "}
              {cells.length === 1 ? "market" : "markets"} — usually under 2
              minutes{elapsedSec > 0 ? ` · ${elapsedSec}s` : ""}.
            </div>
            {/* Honest "what we're doing" narrative — each step's state is
                derived from REAL signals (the live persisted count + jobStatus),
                never a fabricated percentage or timer. */}
            <div className="joblist" style={{ marginTop: 0 }}>
              <MapStage
                label="Connected to Google Maps"
                state={liveCount > 0 || elapsedSec >= 3 ? "done" : "running"}
              />
              <MapStage
                label={
                  liveCount > 0
                    ? `Pulling business listings — ${liveCount.toLocaleString()} found`
                    : "Pulling business listings"
                }
                state="running"
              />
              <MapStage
                label="Applying your signals & building the market"
                state="pending"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="callout green section" role="status">
          <Icon name="check" size={16} style={{ flex: "none" }} />
          <div>
            <b>Market mapped</b> — every number below is real.
          </div>
        </div>
      )}

      {jobError ? (
        <div className="callout amber section" role="alert">
          <Icon name="warning" size={16} style={{ flex: "none" }} />
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
          d={
            stillMapping
              ? "mapping…"
              : marketCapped
                ? `top ${localBiz.toLocaleString()} of ~${totalAvailable!.toLocaleString()}`
                : totalAvailable != null
                  ? "the whole market"
                  : "found in this market"
          }
        />
        <StatCard
          k="Have a website"
          to={haveWebsitePct}
          suffix="%"
          loading={stillMapping && knownCells === 0}
          dash={jobFailed && knownCells === 0}
          d="a site you can improve"
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
          to={matchValue ?? 0}
          loading={stillMapping && knownCells === 0}
          dash={
            (jobFailed && knownCells === 0) || (mapped && matchValue == null)
          }
          estimate={matchIsEstimate && matchValue != null}
          indigo
          d={
            mapped && matchValue == null
              ? "computed after enrichment"
              : matchIsEstimate
                ? `est. ${sigCount} signal${sigCount === 1 ? "" : "s"} · exact after enrichment`
                : `your ${sigCount} signal${sigCount === 1 ? "" : "s"} applied`
          }
        />
      </div>

      {/* Per-cell credit matrix — freshness + real business count + the per-cell
          Discover (free) and Enrich (real credits over the enrichable subset)
          cost, once the market is mapped. Skeletons per cell while mapping. */}
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
                  // Three distinct states, never conflated: still being
                  // mapped (skeleton), the run failed so this cell was never
                  // actually checked ("—", not a fake 0), or a real count.
                  const rowLoading = r.neverDiscovered && stillMapping;
                  const cellEnrichable = enrichableCountForCell(r, families);
                  const cellEnrich = enrichCreditsFor(
                    families,
                    cellEnrichable,
                    1,
                  );
                  const skel = (w: number) => (
                    <span
                      className="skel"
                      style={{ width: w, display: "inline-block" }}
                    />
                  );
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
                        {rowLoading
                          ? skel(40)
                          : r.neverDiscovered
                            ? "—"
                            : r.bizCount.toLocaleString()}
                      </td>
                      <td>
                        <span className="cr free">free</span>
                      </td>
                      <td>
                        {rowLoading ? (
                          skel(48)
                        ) : r.neverDiscovered ? (
                          "—"
                        ) : (
                          <span className="cr">
                            <span className="ic-coin sm" aria-hidden="true" />
                            {fmtCredits(cellEnrich)}
                          </span>
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
                <td>
                  <span className="cr free">free</span>
                </td>
                <td>
                  {stillMapping && knownCells === 0 ? (
                    <span
                      className="skel"
                      style={{ width: 50, display: "inline-block" }}
                    />
                  ) : (
                    <span className="cr">
                      <span className="ic-coin sm" aria-hidden="true" />
                      {fmtCredits(enrichCredits)}
                    </span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {notEnrichable > 0 ? (
          <p className="note" style={{ marginTop: 8 }}>
            {notEnrichable.toLocaleString()} of {totBiz.toLocaleString()} have
            no website, so they can&apos;t be enriched for your site-based
            research — enrich prices the {enrichableTotal.toLocaleString()} with
            a site.
          </p>
        ) : null}

        {/* WP7-13 · THIN market — too few businesses for an honest percentile
            distribution, so the workbench shows absolute benchmarks. Stated up
            front so the market-relative claim never silently lies. */}
        {mapped && thinCells.length > 0 ? (
          <p className="note" style={{ marginTop: 8 }} role="status">
            <b>Small market</b> —{" "}
            {thinCells.length === 1
              ? `${thinCells[0].name.split(" · ")[0]} has`
              : `${thinCells.length} of your markets have`}{" "}
            fewer than {THIN_MARKET_THRESHOLD} businesses. There aren&apos;t
            enough to rank leads against the market, so your workbench shows{" "}
            <b>absolute benchmarks</b> (the raw numbers) instead of a &ldquo;vs.
            the market&rdquo; percentile.
          </p>
        ) : null}

        {/* WP7-13 · OVERSIZED market — real but unwieldy; suggest a sub-cell. */}
        {mapped && oversizedCells.length > 0 ? (
          <p className="note" style={{ marginTop: 8 }} role="status">
            <b>Large market</b> —{" "}
            {oversizedCells.length === 1
              ? `${oversizedCells[0].name.split(" · ")[0]} has`
              : "some of your markets have"}{" "}
            {OVERSIZED_MARKET_THRESHOLD.toLocaleString()}+ businesses. You
            don&apos;t have to enrich them all — cap the run to your best N
            below, or go back and narrow to a neighborhood or a tighter radius
            for a sharper, cheaper list.
          </p>
        ) : null}
      </div>

      {/* WP5-4 · FREE pre-enrich filters — narrow the mapped market before
          committing credits; the surviving count is server-counted and the
          filter object rides the preflight so the priced set == this set. */}
      {mapped && totBiz > 0 ? (
        <PreEnrichFilters
          filters={marketFilters}
          onChange={(f) => {
            setMarketFilters(f);
            // A different set → the old cap + credit wall no longer apply.
            setPickedN(null);
            setCreditWall(null);
          }}
          total={totBiz}
          matching={filtersActive ? (filteredForKey?.total ?? null) : totBiz}
          enrichable={
            filtersActive
              ? (filteredForKey?.enrichable ?? null)
              : enrichableTotal
          }
          hideWebsite={goalNeedsWebsite}
          capControl={
            effEnrichable > 0 ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <span className="setl" style={{ whiteSpace: "nowrap" }}>
                    Cap the run to your best
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={effEnrichable}
                    step={1}
                    value={Math.max(1, selectedN)}
                    onChange={(e) => {
                      setPickedN(Number(e.target.value) || 1);
                      setCreditWall(null);
                    }}
                    aria-label="Number of leads to enrich"
                    style={{ flex: "1 1 auto", minWidth: 120 }}
                  />
                  <input
                    type="number"
                    min={1}
                    max={effEnrichable}
                    value={Math.max(1, selectedN)}
                    onChange={(e) => {
                      const n = Math.floor(Number(e.target.value));
                      if (Number.isFinite(n)) {
                        setPickedN(Math.max(1, Math.min(n, effEnrichable)));
                        setCreditWall(null);
                      }
                    }}
                    aria-label="Number of leads to enrich (exact)"
                    style={{ width: 90 }}
                  />
                  <span className="note" style={{ whiteSpace: "nowrap" }}>
                    of {effEnrichable.toLocaleString()}
                    {filtersActive ? " filtered" : ""} · busiest first
                  </span>
                  {capped && affordableN >= effEnrichable ? (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => setPickedN(effEnrichable)}
                    >
                      All {effEnrichable.toLocaleString()}
                    </button>
                  ) : null}
                </div>
                <p className="note" style={{ margin: "8px 0 0" }}>
                  Ranked by review count — 1 credit per lead.{" "}
                  {walletCredits != null && affordableN < effEnrichable
                    ? `Your ${fmtCredits(walletCredits)} credits cover your best ${affordableN.toLocaleString()}.`
                    : "Dial down to control spend."}{" "}
                  The total is re-quoted before anything is charged.
                </p>
              </>
            ) : null
          }
        />
      ) : null}

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
          <h2 style={{ margin: "0 0 4px" }}>What it costs</h2>
          <div className="sig">
            <div className="row">
              <span className="name">
                ① Discover {cells.length} market{cells.length === 1 ? "" : "s"}
              </span>
              <span className="val cr free">free</span>
            </div>
            <div className="note">
              Always free — the whole raw market, before you spend anything.
            </div>
          </div>
          <div className="sig">
            <div className="row">
              <span className="name">② Enrich — per research</span>
              <span className="val cr">
                <span className="ic-coin sm" aria-hidden="true" />~
                {fmtCredits(enrichCredits)}
              </span>
            </div>
            <div style={{ marginTop: 8 }}>
              {researchRows.length > 0 ? (
                researchRows.map((r) => (
                  <div className="enr-sub" key={r.family}>
                    <span className="lbl">
                      {r.label}{" "}
                      <span className="src">
                        · {RESEARCH_SOURCES[r.family]}
                      </span>
                    </span>
                    <span className="cr">
                      {mapped || knownCells > 0
                        ? r.credits === 0
                          ? "included" // e.g. tech rides the contacts scan
                          : `~${fmtCredits(r.credits)} cr`
                        : r.basis === "cell"
                          ? "per market"
                          : "per lead"}
                    </span>
                  </div>
                ))
              ) : (
                <p className="note">
                  No enrichment research — add signals on the Goal step.
                </p>
              )}
            </div>
          </div>
          <div className="sig">
            <div className="row">
              <span className="name">Estimated total</span>
              <span className="val cr" style={{ fontSize: 15 }}>
                <span className="ic-coin sm" aria-hidden="true" />~
                {fmtCredits(enrichCredits)}
              </span>
            </div>
            <div className="note">
              {/* WP2-5 · honest copy: the real subset path is the best-N cap
                  below (WP2-2), not a per-lead hand-pick (that's WP5). */}
              {mapped
                ? `Enrich all ${enrichableTotal.toLocaleString()} businesses with a website — or cap the run to your best N below. ≈${fmtCredits(enrichRate)} credit${enrichRate === 1 ? "" : "s"}/lead.`
                : knownCells > 0
                  ? "Firms up the moment the rest of the market finishes mapping."
                  : "Confirmed the moment mapping finishes — you pay only for the leads you choose to enrich."}
            </div>
          </div>
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

      {/* WP2-3 · the credit wall — an inline upgrade sheet (top-N fallback +
          top-up packs + next plan + billing deep-link), never a dead-end
          toast. */}
      {creditWall ? (
        <CreditWallSheet
          needCredits={creditWall.needCredits}
          walletCredits={walletCredits ?? 0}
          locale={locale}
          affordable={
            affordableN > 0
              ? {
                  n: affordableN,
                  of: effEnrichable,
                  credits: affordableCredits,
                }
              : null
          }
          onPickTopN={(n) => {
            setPickedN(n);
            setCreditWall(null);
          }}
          onClose={() => setCreditWall(null)}
        />
      ) : null}

      {/* Sticky dark costbar — swaps from "Mapping…" to "Enrich →" itself,
          the moment the market is real. No separate Discover step/click. */}
      <div className="costbar">
        {/* min-width:0 lets this block actually shrink/wrap inside the flex
            row instead of forcing the container wider than the buttons can
            afford — without it, a longer message pushes the button group
            right up against the text with no breathing room. */}
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div className="big">
            <span className="ic-coin" aria-hidden="true" />{" "}
            {jobFailed ? (
              "Mapping failed"
            ) : mapped ? (
              <>
                {capped
                  ? `Enrich best ${selectedN.toLocaleString()} of ${effEnrichable.toLocaleString()}${filtersActive ? " filtered" : ""}`
                  : `Enrich ${effEnrichable.toLocaleString()}${filtersActive ? " filtered" : ""} business${effEnrichable === 1 ? "" : "es"}`}
                <span className="small">
                  {" "}
                  {/* WP4-6 · NET credits once the server quote lands. */}·{" "}
                  {netCredits != null
                    ? `${fmtCredits(netCredits)} credits`
                    : `~${fmtCredits(selectedCredits)} credits`}
                  {freshSaved > 0
                    ? ` · ${fmtCredits(freshSaved)} saved from fresh cache`
                    : ""}
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
                : canAfford && selectedN > 0
                  ? `Applies your ${sigCount} signal${sigCount === 1 ? "" : "s"}${families.includes("contacts") ? " and reveals contacts" : ""} · ~${enrichMinutes} min`
                  : `Needs ~${fmtCredits(selectedN > 0 ? (netCredits ?? selectedCredits) : minRunCredits)} credits — you have ${fmtCredits(walletCredits ?? 0)}. Options open on click.`}
          </div>
        </div>
        <span className="spacer" />
        {/* flexShrink:0 + its own gap so the buttons keep consistent spacing
            from each other no matter how the text block above shrinks/wraps. */}
        <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
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
            {/* "Add credits →" is NOT a dead end: the click routes through
                enrich(), which opens the credit-wall sheet (WP2-3). */}
            {jobFailed
              ? "Failed"
              : !mapped
                ? "Mapping…"
                : runningEnrich
                  ? "Starting…"
                  : canAfford && selectedN > 0
                    ? "Enrich →"
                    : "Add credits →"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One line of the "what we're doing" mapping narrative — reuses the ported
 *  .job/.check/.spin classes (same as the Enriching step's stage list). */
function MapStage({
  label,
  state,
}: {
  label: string;
  state: "done" | "running" | "pending";
}) {
  return (
    <div
      className="job"
      style={state === "pending" ? { opacity: 0.5 } : undefined}
    >
      {state === "done" ? (
        <span className="check" aria-hidden="true">
          ✓
        </span>
      ) : state === "running" ? (
        <span className="spin" aria-hidden="true" />
      ) : (
        <span style={{ width: 16 }} aria-hidden="true" />
      )}
      {label}
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
  estimate,
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
  /** Prefix the number with "~" — it's an honest estimate that firms up after
   *  enrichment (e.g. "match your signals" pre-enrichment). */
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
        {loading ? (
          <span
            className="skel"
            style={{ width: 56, height: 22, display: "inline-block" }}
          />
        ) : dash ? (
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
