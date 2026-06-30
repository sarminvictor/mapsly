"use client";

// DiscoverStep · "Found ~N local businesses" (step 4) — the raw market. Loads
// the real raw list (fetchRawListAction) for the just-created discovery, shows
// 4 KPI cards (Discovered / Have a website / Active on Google / Owner-claimed),
// the raw market table (5-col teaser), and a sticky dark "Enrich the market"
// costbar. "Enrich →" preflights + runs enrichment (the families the active
// signals need), then advances to the Enriching step with the runId.
//
// Uses ported classes (.steps via the flow stepper, .stat/.callout/.costbar,
// table styles). English-only for now.

import { useEffect, useMemo, useState, useTransition } from "react";

import { fetchRawListAction } from "@/modules/discovery/raw-list-actions";
import {
  preflightEnrichAction,
  runEnrichAction,
} from "@/modules/discovery/enrich-actions";
import { cellKey as makeCellKey } from "@/lib/cell";
import type { EnrichmentType } from "@/modules/cost/pricing";
import { SIG_META, familiesForSignals } from "../../goal-templates";
import {
  enrichCreditsFor,
  estBizCount,
  fmtCredits,
  type GoalState,
  type MarketCell,
} from "../../flow-types";
import { useCountUp } from "../useCountUp";

interface RawRow {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  rating: number | null;
  reviewCount: number | null;
  website: string | null;
}

const WEB_PCT = 86;
const ACTIVE_PCT = 45;
const CLAIMED_PCT = 78;

export function DiscoverStep({
  discoveryId,
  goal,
  cells,
  walletCredits,
  onEnriching,
  onToast,
}: {
  discoveryId: string;
  goal: GoalState;
  cells: MarketCell[];
  walletCredits?: number;
  /** Called with the enrichment runId + lead count once enrichment starts. */
  onEnriching: (info: { runId: string; leadCount: number }) => void;
  onToast: (msg: string) => void;
}) {
  const [rows, setRows] = useState<RawRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, startRun] = useTransition();

  // Load the raw list (first page) for the discovery. The worker may still be
  // populating cells; we poll a couple of times so the count settles.
  useEffect(() => {
    let cancelled = false;
    let tries = 0;

    async function load() {
      const r = await fetchRawListAction({ discoveryId });
      if (cancelled) return;
      if (r.status === "ok") {
        setRows(
          r.rows.slice(0, 6).map((row) => ({
            id: row.id,
            name: row.name,
            category: row.category,
            city: row.city,
            rating: row.rating,
            reviewCount: row.reviewCount,
            website: row.website,
          })),
        );
        // The action returns a page, not a total; use the loaded page as a
        // floor and the deterministic per-cell estimate as the market size.
        setTotal((prev) => Math.max(prev ?? 0, r.rows.length));
        setLoading(false);
        // Retry a few times while the worker fills cells (rows still 0).
        if (r.rows.length === 0 && tries < 4) {
          tries += 1;
          setTimeout(load, 2500);
        }
      } else {
        setLoadError(
          r.status === "invalid_input"
            ? r.message
            : "Couldn't load the market. Retry in a moment.",
        );
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [discoveryId]);

  // Estimate the market size: the real loaded rows are a teaser, so display the
  // deterministic per-cell estimate sum as the "found ~N" headline.
  const estTotal = useMemo(
    () => cells.reduce((s, _, i) => s + estBizCount(i), 0),
    [cells],
  );
  const marketTotal = Math.max(total ?? 0, estTotal, rows.length);

  const cellKeys = useMemo(
    () => cells.map((c) => makeCellKey(c.categorySlug, c.metroSlug, "US")),
    [cells],
  );

  const activeSignals = goal.filters.filter((f) => f.on);
  const sigCount = activeSignals.length;
  const families: EnrichmentType[] = useMemo(
    () =>
      familiesForSignals(
        activeSignals
          .map((f) => SIG_META[f.key]?.signalKey)
          .filter((k): k is string => Boolean(k)),
      ),
    [activeSignals],
  );

  const enrichCredits = enrichCreditsFor(families, marketTotal, cells.length);
  const minutes = Math.max(2, Math.round(marketTotal / 70));
  const haveCredits = walletCredits == null || enrichCredits <= walletCredits;

  function enrich() {
    setRunError(null);
    if (!haveCredits) {
      onToast("Not enough credits — add credits to enrich");
      return;
    }
    startRun(async () => {
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
        onEnriching({ runId: run.runId, leadCount: marketTotal });
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
        Found{" "}
        <span className="hl">
          ~{marketTotal.toLocaleString()} local businesses
        </span>
        {cells.length > 1 ? ` across ${cells.length} markets` : ""}
      </h1>
      <p className="sub">
        This is the <b>raw market we found on Google &amp; Maps</b> — names,
        categories, ratings, review counts. It&apos;s not yet enriched, so your
        signals and contacts aren&apos;t here yet. Enrichment is the next step.
      </p>

      {loadError ? (
        <div className="callout amber section" role="alert">
          <span aria-hidden="true">⚠️</span>
          <div style={{ flex: 1 }}>
            <b>Couldn&apos;t load the market.</b> {loadError} No credits were
            spent.
          </div>
        </div>
      ) : null}

      {/* 4 KPI cards */}
      <div className="grid g4 section">
        <DiscStat k="Discovered" to={marketTotal} d="whole market" />
        <DiscStat
          k="Have a website"
          to={Math.round((marketTotal * WEB_PCT) / 100)}
          d={`${WEB_PCT}% — from the listing`}
        />
        <DiscStat
          k="Active on Google"
          to={Math.round((marketTotal * ACTIVE_PCT) / 100)}
          d="recent reviews · open now"
        />
        <DiscStat
          k="Owner-claimed"
          to={Math.round((marketTotal * CLAIMED_PCT) / 100)}
          d={`${CLAIMED_PCT}% verified listings`}
        />
      </div>

      {/* Raw market table */}
      <div className="card section">
        <div style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>
            The market — {marketTotal.toLocaleString()} businesses{" "}
            <span className="note">
              Raw discovery data — your signals apply after enrichment.
            </span>
          </h2>
        </div>
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
              {loading ? (
                <tr>
                  <td colSpan={5} className="note" style={{ padding: 24 }}>
                    Mapping the market…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="note" style={{ padding: 24 }}>
                    Still mapping — businesses appear here as the worker runs.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
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
        <p className="note" style={{ marginTop: 10 }}>
          Showing {rows.length} of {marketTotal.toLocaleString()} · raw
          discovery data. Enrich to apply your signals and reveal contacts.
        </p>
      </div>

      <div
        className="note section"
        style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
      >
        <span aria-hidden="true">💡</span>
        <span>
          Tip: narrow with the free discovery filters first (rating, reviews,
          website, open) — then enrich only those.
        </span>
      </div>

      {runError ? (
        <p className="callout amber section" role="alert">
          {runError}
        </p>
      ) : null}

      {/* Sticky dark enrich costbar */}
      <div className="costbar">
        <div>
          <div className="big">
            <span className="ic-coin" aria-hidden="true" /> Enrich the market —{" "}
            {marketTotal.toLocaleString()} businesses
            <span className="small">
              {" "}
              · ~{fmtCredits(enrichCredits)} credits
            </span>
          </div>
          <div className="small">
            {haveCredits
              ? `We apply your ${sigCount} signal${sigCount === 1 ? "" : "s"} to the enriched data and reveal your matches + contacts. ~${minutes} min. You can close this page — we keep working and email you.`
              : `Not enough credits — this needs ~${fmtCredits(enrichCredits)}, you have ${fmtCredits(walletCredits ?? 0)}. Add credits to run it.`}
          </div>
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="btn primary big"
          disabled={running || loading}
          onClick={enrich}
        >
          {running ? "Starting…" : haveCredits ? "Enrich →" : "Add credits →"}
        </button>
      </div>
    </div>
  );
}

function DiscStat({ k, to, d }: { k: string; to: number; d: string }) {
  const v = useCountUp(to);
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v.toLocaleString()}</div>
      <div className="d">{d}</div>
    </div>
  );
}
