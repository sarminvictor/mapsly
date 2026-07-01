"use client";

// DiscoverStep · "Found N local businesses" (step 4) — the raw market. Loads
// the real raw list (fetchRawListAction) + the REAL KPI summary
// (getDiscoverySummary) for the just-created discovery, shows 4 KPI cards
// (Discovered / Have a website / Active on Google / Owner-claimed), the raw
// market table (5-col teaser), and a sticky dark "Enrich the market" costbar.
//
// HONESTY RULE: while the worker is still mapping the market, we show NOTHING
// for the counts ("—" / "mapping…") rather than estimates — fake numbers are
// worse than no numbers. "Mapped" is driven by the discovery's REAL jobStatus
// (READY/PARTIAL — a terminal state), never inferred from "total > 0" (which
// could show a partial in-progress count as final, or never notice a genuinely
// empty market is done). The KPI cards, headline, table total, and Enrich
// button only show real figures once jobStatus is terminal; FAILED shows a
// clear error instead of spinning forever.
//
// "Enrich →" preflights + runs enrichment (the families the active signals need),
// then advances to the Enriching step with the runId. Uses ported classes
// (.stat/.callout/.costbar, table styles). English-only for now.

import { useEffect, useMemo, useState, useTransition } from "react";

import {
  fetchRawListAction,
  getDiscoverySummary,
  type DiscoverySummary,
} from "@/modules/discovery/raw-list-actions";
import {
  preflightEnrichAction,
  runEnrichAction,
} from "@/modules/discovery/enrich-actions";
import { cellKey as makeCellKey } from "@/lib/cell";
import type { EnrichmentType } from "@/modules/cost/pricing";
import { researchesForSignals } from "../../researches";
import {
  enrichCreditsFor,
  enrichRatePerLead,
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
  const [summary, setSummary] = useState<DiscoverySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, startRun] = useTransition();
  const [elapsedSec, setElapsedSec] = useState(0);

  // Load the raw list (first page) + the REAL job status + KPI summary for the
  // discovery. The cron drains PENDING discoveries every ~2 min, then
  // `runDiscovery` itself can take another 30s–2min depending on market size —
  // so we poll on the discovery's REAL `jobStatus`, not an inferred "total > 0"
  // guess (which could (a) show a partial in-progress count as final, and (b)
  // give up after a fixed number of tries and leave the page silently stuck —
  // exactly what happened before this fix). Poll INDEFINITELY while
  // PENDING/RUNNING; stop the instant the job reaches a terminal status
  // (READY/PARTIAL/FAILED) — never abandon the user mid-map.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    async function load() {
      const [r, s] = await Promise.all([
        fetchRawListAction({ discoveryId }),
        getDiscoverySummary({ discoveryId }),
      ]);
      if (cancelled) return;
      setElapsedSec(Math.round((Date.now() - startedAt) / 1000));

      if (s.status === "ok") {
        setSummary(s.summary);
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
        }
        setLoading(false);
        // Still mapping — keep polling, no give-up cap. The job WILL reach a
        // terminal status; a fixed retry cap is what silently stranded users.
        if (
          s.summary.jobStatus === "PENDING" ||
          s.summary.jobStatus === "RUNNING"
        ) {
          timer = setTimeout(load, 3000);
        }
      } else if (r.status === "ok") {
        // Summary call failed but the raw list loaded — show what we have and
        // keep polling for the summary (rare transient case).
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
        setLoading(false);
        timer = setTimeout(load, 3000);
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
      if (timer) clearTimeout(timer);
    };
  }, [discoveryId]);

  // REAL data only — "mapped" is true once the job reaches a terminal status.
  // A genuinely empty market (jobStatus done, total 0) is a valid real answer,
  // never confused with "still working". Until terminal, every count renders
  // as a placeholder, never a guess.
  const jobFailed = summary?.jobStatus === "FAILED";
  const mapped =
    summary != null &&
    (summary.jobStatus === "READY" || summary.jobStatus === "PARTIAL");
  const total = mapped ? summary.total : null;

  const cellKeys = useMemo(
    () => cells.map((c) => makeCellKey(c.categorySlug, c.metroSlug, c.country)),
    [cells],
  );

  const activeSignals = useMemo(
    () => goal.filters.filter((f) => f.on),
    [goal.filters],
  );
  const sigCount = activeSignals.length;
  // The research families the active signals depend on — every enrichment the
  // workflow must run so the toggled signals can be evaluated (dependency chains
  // expanded, e.g. tech → contacts). Same EnrichmentType[] shape the preflight,
  // credit estimate, and dispatch all consume.
  const families: EnrichmentType[] = useMemo(
    () => researchesForSignals(activeSignals),
    [activeSignals],
  );

  const enrichRate = useMemo(() => enrichRatePerLead(families), [families]);

  const enrichCredits = mapped
    ? enrichCreditsFor(families, summary.total, cells.length)
    : 0;
  const minutes = mapped ? Math.max(2, Math.round(summary.total / 70)) : 0;
  const haveCredits = walletCredits == null || enrichCredits <= walletCredits;

  function enrich() {
    setRunError(null);
    if (!mapped) return;
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
        onEnriching({ runId: run.runId, leadCount: summary.total });
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
              {total!.toLocaleString()} local businesses
            </span>
            {cells.length > 1 ? ` across ${cells.length} markets` : ""}
          </>
        ) : jobFailed ? (
          <span className="hl">Mapping failed</span>
        ) : (
          <span className="hl">Mapping the market…</span>
        )}
      </h1>
      <p className="sub">
        This is the <b>raw market we find on Google &amp; Maps</b> — names,
        categories, ratings, review counts. It&apos;s not yet enriched, so your
        signals and contacts aren&apos;t here yet. Enrichment is the next step.
      </p>

      {jobFailed ? (
        <div className="callout amber section" role="alert">
          <span aria-hidden="true">⚠️</span>
          <div style={{ flex: 1 }}>
            <b>This market couldn&apos;t be mapped.</b> No credits were spent —
            go back and try again, or try a different market.
          </div>
        </div>
      ) : !mapped && !loading ? (
        <div className="callout section" role="status">
          <span aria-hidden="true">🗺️</span>
          <div style={{ flex: 1 }}>
            Still mapping — a new market can take a couple of minutes.{" "}
            {elapsedSec > 0 ? `${elapsedSec}s elapsed. ` : ""}
            You can leave this page — we keep working and pick up where you left
            off.
          </div>
        </div>
      ) : null}

      {loadError ? (
        <div className="callout amber section" role="alert">
          <span aria-hidden="true">⚠️</span>
          <div style={{ flex: 1 }}>
            <b>Couldn&apos;t load the market.</b> {loadError} No credits were
            spent.
          </div>
        </div>
      ) : null}

      {/* 4 KPI cards — REAL counts from the discovery summary only. While the
          worker is still mapping, each shows "—" / "mapping…", never an estimate. */}
      <div className="grid g4 section">
        <DiscStat
          k="Discovered"
          value={mapped ? summary.total : null}
          d="whole market"
        />
        <DiscStat
          k="Have a website"
          value={mapped ? summary.withWebsite : null}
          d="from the listing"
        />
        <DiscStat
          k="Active on Google"
          value={mapped ? summary.activeOnGoogle : null}
          d="recent reviews · open now"
        />
        <DiscStat
          k="Owner-claimed"
          value={mapped ? summary.ownerClaimed : null}
          d="verified listings"
        />
      </div>

      {/* Raw market table */}
      <div className="card section">
        <div style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>
            {mapped
              ? `The market — ${total!.toLocaleString()} businesses`
              : jobFailed
                ? "Mapping failed"
                : "Mapping the market…"}{" "}
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
                    Loading…
                  </td>
                </tr>
              ) : jobFailed ? (
                <tr>
                  <td colSpan={5} className="note" style={{ padding: 24 }}>
                    This market couldn&apos;t be mapped — go back and try again.
                  </td>
                </tr>
              ) : mapped && total === 0 ? (
                <tr>
                  <td colSpan={5} className="note" style={{ padding: 24 }}>
                    No businesses found in this market. Try a different category
                    or city.
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
          Showing {rows.length} of {mapped ? total!.toLocaleString() : "…"} ·
          raw discovery data. Enrich to apply your signals and reveal contacts.
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
            <span className="ic-coin" aria-hidden="true" />{" "}
            {mapped ? (
              <>
                Enrich the market — {total!.toLocaleString()} businesses
                <span className="small">
                  {" "}
                  · ~{fmtCredits(enrichCredits)} credits (
                  {fmtCredits(enrichRate)}/lead)
                </span>
              </>
            ) : jobFailed ? (
              "Mapping failed"
            ) : (
              "Mapping the market…"
            )}
          </div>
          <div className="small">
            {jobFailed
              ? "This market couldn't be mapped — no credits were spent. Go back and try again."
              : !mapped
                ? "Discovery is free and still running — enrichment unlocks the moment the market is mapped."
                : haveCredits
                  ? `We apply your ${sigCount} signal${sigCount === 1 ? "" : "s"} to the enriched data and reveal your matches + contacts. ~${minutes} min. You can close this page — we keep working and email you.`
                  : `Not enough credits — this needs ~${fmtCredits(enrichCredits)}, you have ${fmtCredits(walletCredits ?? 0)}. Add credits to run it.`}
          </div>
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="btn primary big"
          disabled={running || loading || !mapped}
          onClick={enrich}
        >
          {jobFailed
            ? "Failed"
            : !mapped
              ? "Mapping…"
              : running
                ? "Starting…"
                : haveCredits
                  ? "Enrich →"
                  : "Add credits →"}
        </button>
      </div>
    </div>
  );
}

function DiscStat({
  k,
  value,
  d,
}: {
  k: string;
  value: number | null;
  d: string;
}) {
  // Hook is always called (count-up to 0 when there's no real value yet); the
  // render shows a placeholder rather than the estimate while mapping.
  const v = useCountUp(value ?? 0);
  const ready = value != null;
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v" style={ready ? undefined : { color: "var(--faint)" }}>
        {ready ? v.toLocaleString() : "—"}
      </div>
      <div className="d">{ready ? d : "mapping…"}</div>
    </div>
  );
}
