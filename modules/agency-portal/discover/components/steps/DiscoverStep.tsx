"use client";

// DiscoverStep · "Found N local businesses" (step 4) — the raw market. Loads
// the real raw list (fetchRawListAction) + the REAL KPI summary
// (getDiscoverySummary) for the just-created discovery, shows 4 KPI cards
// (Discovered / Have a website / Active on Google / Owner-claimed), the raw
// market table (5-col teaser), and a sticky dark "Enrich the market" costbar.
//
// HONESTY RULE: while the worker is still mapping the market (no real rows yet),
// we show NOTHING for the counts ("—" / "mapping…") rather than estimates — fake
// numbers are worse than no numbers. The KPI cards, headline, table total, and
// Enrich button only show real figures once getDiscoverySummary returns a real
// count (> 0); until then Enrich is disabled (there's nothing to enrich yet).
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
import { SIG_META, familiesForSignals } from "../../goal-templates";
import {
  enrichCreditsFor,
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

  // Load the raw list (first page) + the REAL KPI summary for the discovery.
  // The worker may still be populating cells; poll a few times while it's empty
  // so the counts settle. getDiscoverySummary returns exact Prisma counts over
  // the discovery's cells — no estimates.
  useEffect(() => {
    let cancelled = false;
    let tries = 0;

    async function load() {
      const [r, s] = await Promise.all([
        fetchRawListAction({ discoveryId }),
        getDiscoverySummary({ discoveryId }),
      ]);
      if (cancelled) return;
      if (s.status === "ok") setSummary(s.summary);
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
        setLoading(false);
        // Keep polling while the worker is still mapping (no real data yet).
        const realTotal = s.status === "ok" ? s.summary.total : 0;
        if (realTotal === 0 && r.rows.length === 0 && tries < 8) {
          tries += 1;
          setTimeout(load, 3000);
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

  // REAL data only — "mapped" is true once the summary reports a real count.
  // Until then every count renders as a placeholder, never an estimate.
  const mapped = summary != null && summary.total > 0;
  const total = mapped ? summary.total : null;

  const cellKeys = useMemo(
    () => cells.map((c) => makeCellKey(c.categorySlug, c.metroSlug, "US")),
    [cells],
  );

  const activeSignals = useMemo(
    () => goal.filters.filter((f) => f.on),
    [goal.filters],
  );
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
        ) : (
          <span className="hl">Mapping the market…</span>
        )}
      </h1>
      <p className="sub">
        This is the <b>raw market we find on Google &amp; Maps</b> — names,
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
                  · ~{fmtCredits(enrichCredits)} credits
                </span>
              </>
            ) : (
              "Mapping the market…"
            )}
          </div>
          <div className="small">
            {!mapped
              ? "Discovery is still running — enrichment unlocks the moment the market is mapped."
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
          {!mapped
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
