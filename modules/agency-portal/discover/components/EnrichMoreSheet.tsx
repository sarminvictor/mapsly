"use client";

// EnrichMoreSheet · WP5-3 · in-workbench per-family enrichment. Every surface
// that advertises "enrich to unlock" (coverage panel CTA, drawer ghost
// accordions, locked Fields-catalog rows) opens THIS sheet instead of dead-
// ending or deep-linking away from the workbench. It quotes the CURRENT scope
// (selected leads / visible leads / the whole research) over the picked
// families via preflightEnrichAction, confirms in credits, and enqueues via
// runEnrichAction — after which the page refresh lets the WP4
// LiveWorkbenchBanner take over ("leads update live").
//
// Absorbed the per-family credit-line + net-quote + fresh-cache-savings +
// Add-credits-deficit-deep-link patterns from the old EnrichPanel/CostQuoteBar
// (since removed as dead — WP10-6) but speaks CREDITS natively end-to-end
// (WP4-10 — one in-product currency).
//
// Per .claude/rules/ui-ux-agency.md: dense, numbers over adjectives, jargon-OK.
// Per cache-components Pattern 4: mounted by a client parent — no function
// props cross a server boundary. English-only.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Link } from "@/i18n/navigation";
import { showToast } from "@/components/agency/Toast";
import {
  ALL_ENRICHMENT_TYPES,
  CREDIT_PRICES,
  ENRICHMENT_PRICES,
  type EnrichmentType,
  type ScopeUnit,
} from "@/modules/cost/pricing";
import {
  preflightEnrichAction,
  runEnrichAction,
} from "@/modules/discovery/enrich-actions";
import { getEnrichScopeAction } from "../enrich-scope-actions";
import { resolveResearches } from "../researches";
import { enrichCreditsFor, fmtCredits } from "../flow-types";
import type { EnrichSheetRequest } from "../enrich-sheet-bus";

type ScopeChoice = "selected" | "visible" | "all";

interface ScopeInfo {
  cellKeys: string[];
  marketCount: number;
  walletCredits: number;
}

interface Quote {
  /** What this quote priced — invalidated by any family/scope change. */
  forKey: string;
  estimateId: string;
  netCredits: number;
  freshCredits: number;
}

function unitLabel(unit: ScopeUnit): string {
  return unit === "cell" ? "per market cell" : "per lead";
}

export function EnrichMoreSheet({
  discoveryId,
  request,
  onClose,
}: {
  discoveryId: string;
  request: EnrichSheetRequest;
  onClose: () => void;
}) {
  const router = useRouter();
  const [scopeInfo, setScopeInfo] = useState<ScopeInfo | null>(null);
  const [scopeError, setScopeError] = useState(false);
  // Open with NOTHING selected — the user picks the families to enrich (or hits
  // "Select all"). Previously the caller's suggested families (e.g. every
  // missing one from the coverage CTA) were pre-checked, which surprised the
  // user with a big pre-selected bill on open.
  const [selected, setSelected] = useState<Set<EnrichmentType>>(
    () => new Set<EnrichmentType>(),
  );
  const selectedIds = useMemo(
    () => request.scope?.selectedBusinessIds ?? [],
    [request],
  );
  const visibleIds = useMemo(
    () => request.scope?.visibleBusinessIds ?? [],
    [request],
  );
  const [scope, setScope] = useState<ScopeChoice>(() =>
    selectedIds.length > 0
      ? "selected"
      : visibleIds.length > 0
        ? "visible"
        : "all",
  );
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Deficit → the wallet can't cover the net quote (renders Add credits →).
  const [deficit, setDeficit] = useState<number | null>(null);
  const fetchedFor = useRef<string | null>(null);

  // Load cellKeys + market count + wallet once per open (per discovery).
  useEffect(() => {
    if (fetchedFor.current === discoveryId) return;
    fetchedFor.current = discoveryId;
    void (async () => {
      const r = await getEnrichScopeAction({ discoveryId });
      if (r.status === "ok") {
        setScopeInfo({
          cellKeys: r.cellKeys,
          marketCount: r.marketCount,
          walletCredits: r.walletCredits,
        });
      } else {
        setScopeError(true);
      }
    })();
  }, [discoveryId]);

  // Escape closes (scrim click handled on the overlay).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const scopeIds =
    scope === "selected" ? selectedIds : scope === "visible" ? visibleIds : [];
  const scopeCount =
    scope === "all" ? (scopeInfo?.marketCount ?? 0) : scopeIds.length;
  const cellCount = scopeInfo?.cellKeys.length ?? 0;

  // Resolve dependencies (tech → +contacts) exactly like the get-leads flow, so
  // the sheet quotes + bills the same families the dispatch will run — a
  // tech-only pick pulls the contacts scan it rides on (and its 1 credit),
  // instead of quoting a free tech-only run (tech = 0 credits on its own).
  const enrichments = useMemo(
    () => resolveResearches([...selected]),
    [selected],
  );
  // Any family/scope change invalidates a standing quote.
  const quoteKey = `${scope}:${scopeCount}:${enrichments.join(",")}`;
  const activeQuote = quote && quote.forKey === quoteKey ? quote : null;

  // Client-side GROSS estimate (CREDIT_PRICES) — the server preflight returns
  // the honest NET once priced (fresh units served from cache at 0 credits).
  const grossCredits = useMemo(
    () => enrichCreditsFor(enrichments, scopeCount, cellCount),
    [enrichments, cellCount, scopeCount],
  );

  function toggle(key: EnrichmentType) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setError(null);
    setDeficit(null);
  }

  function selectAll() {
    setSelected(new Set(ALL_ENRICHMENT_TYPES));
    setError(null);
    setDeficit(null);
  }

  function deselectAll() {
    setSelected(new Set());
    setError(null);
    setDeficit(null);
  }

  const allSelected = selected.size === ALL_ENRICHMENT_TYPES.length;

  function priceIt() {
    if (!scopeInfo || enrichments.length === 0) return;
    setError(null);
    setDeficit(null);
    const forKey = quoteKey;
    startTransition(async () => {
      const r = await preflightEnrichAction({
        businessIds: scopeIds,
        cellKeys: scopeInfo.cellKeys,
        enrichments,
      });
      if (r.status === "ok") {
        setQuote({
          forKey,
          estimateId: r.estimateId,
          netCredits: r.netCredits,
          // Credits saved by fresh-cache dedup = gross (all units) − server NET.
          freshCredits: Math.max(0, grossCredits - r.netCredits),
        });
        if (r.netCredits > scopeInfo.walletCredits) {
          setDeficit(r.netCredits - scopeInfo.walletCredits);
        }
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
    if (!activeQuote) return;
    setError(null);
    startTransition(async () => {
      const r = await runEnrichAction({ estimateId: activeQuote.estimateId });
      if (r.status === "ok") {
        showToast("Enrichment started — leads update live as it runs");
        // The workbench page re-renders with the new PENDING run → the WP4
        // LiveWorkbenchBanner mounts and takes over from here.
        router.refresh();
        onClose();
      } else if (r.status === "insufficient_credits") {
        setDeficit(r.netCredits - (scopeInfo?.walletCredits ?? 0));
      } else if (r.status === "needs_requote" || r.status === "quote_expired") {
        setQuote(null);
        setError("The quote changed — price it again.");
      } else {
        setError(`Couldn't start enrichment (${r.status}).`);
      }
    });
  }

  const scopeOptions: { key: ScopeChoice; label: string; n: number }[] = [
    ...(selectedIds.length > 0
      ? [
          {
            key: "selected" as const,
            label: `Selected (${selectedIds.length.toLocaleString()})`,
            n: selectedIds.length,
          },
        ]
      : []),
    ...(visibleIds.length > 0
      ? [
          {
            key: "visible" as const,
            label: `Visible (${visibleIds.length.toLocaleString()})`,
            n: visibleIds.length,
          },
        ]
      : []),
    {
      key: "all" as const,
      label: scopeInfo
        ? `Whole research (${scopeInfo.marketCount.toLocaleString()})`
        : "Whole research",
      n: scopeInfo?.marketCount ?? 0,
    },
  ];

  return (
    <div
      className="overlay center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="enrichMoreTitle"
        style={{ maxWidth: 520 }}
      >
        <div className="mhead">
          <h2 id="enrichMoreTitle">Enrich more data</h2>
          <span className="note">
            {cellCount > 0
              ? `${cellCount} market cell${cellCount === 1 ? "" : "s"}`
              : ""}
          </span>
          <button
            type="button"
            className="x"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="mbody">
          {scopeError ? (
            <p className="note" role="alert">
              Couldn&apos;t load this research&apos;s scope. Close and try
              again.
            </p>
          ) : null}

          {/* Scope */}
          <div className="setrow" style={{ marginBottom: 10 }}>
            <span className="setl">Scope</span>
            <div
              className="chipset"
              role="radiogroup"
              aria-label="Enrich scope"
            >
              {scopeOptions.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={scope === o.key}
                  className={`ch ${scope === o.key ? "on" : ""}`}
                  onClick={() => {
                    setScope(o.key);
                    setError(null);
                    setDeficit(null);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Data-family header + bulk select controls. */}
          <div
            className="setrow"
            style={{ marginBottom: 2, alignItems: "baseline" }}
          >
            <span className="setl">Data</span>
            <span style={{ display: "inline-flex", gap: 10 }}>
              <button
                type="button"
                className="rflink"
                disabled={allSelected}
                onClick={selectAll}
              >
                Select all
              </button>
              <button
                type="button"
                className="rflink"
                disabled={selected.size === 0}
                onClick={deselectAll}
              >
                Deselect all
              </button>
            </span>
          </div>

          {/* Family rows — per-line credits over the current scope. */}
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {ALL_ENRICHMENT_TYPES.map((key) => {
              const price = ENRICHMENT_PRICES[key];
              const count = price.unit === "cell" ? cellCount : scopeCount;
              const lineCredits = CREDIT_PRICES[key] * count;
              const on = selected.has(key);
              return (
                <li key={key}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      padding: "6px 4px",
                      borderBottom: "1px solid var(--line-2)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(key)}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600, fontSize: 12.5 }}>
                        {price.label}
                      </span>{" "}
                      <span className="note">
                        · {unitLabel(price.unit)} × {count.toLocaleString()} ·{" "}
                        {price.freshnessDays}d fresh
                      </span>
                    </span>
                    <span className="cr" style={{ flexShrink: 0 }}>
                      {lineCredits === 0 ? (
                        "incl." // e.g. tech rides the contacts scan
                      ) : (
                        <>
                          <span className="ic-coin sm" aria-hidden="true" />
                          {fmtCredits(lineCredits)}
                        </>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {error ? (
            <p
              className="note"
              role="alert"
              style={{ color: "var(--red)", marginTop: 8 }}
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="mfoot" style={{ alignItems: "center", gap: 10 }}>
          <span className="note" style={{ flex: 1, minWidth: 0 }}>
            {activeQuote ? (
              <>
                This will cost{" "}
                <b>{fmtCredits(activeQuote.netCredits)} credits</b>
                {activeQuote.freshCredits > 0
                  ? ` · ${fmtCredits(activeQuote.freshCredits)} saved from fresh cache`
                  : ""}
                {scopeInfo
                  ? ` · wallet ${fmtCredits(scopeInfo.walletCredits)}`
                  : ""}
              </>
            ) : enrichments.length > 0 && scopeCount + cellCount > 0 ? (
              <>
                ~{fmtCredits(grossCredits)} credits before fresh-cache dedupe —
                price it for the exact number.
              </>
            ) : (
              "Pick at least one data family."
            )}
          </span>
          {activeQuote && deficit != null && deficit > 0 ? (
            <Link
              href={{
                pathname: "/team/billing",
                query: { deficit: String(Math.max(1, Math.ceil(deficit))) },
              }}
              className="btn primary"
            >
              Add credits →
            </Link>
          ) : activeQuote ? (
            <button
              type="button"
              className="btn primary"
              disabled={pending}
              onClick={run}
            >
              {pending
                ? "Starting…"
                : `Run · ${fmtCredits(activeQuote.netCredits)} credits`}
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={
                pending ||
                enrichments.length === 0 ||
                !scopeInfo ||
                (scopeCount === 0 && cellCount === 0)
              }
              onClick={priceIt}
            >
              {pending ? "Pricing…" : "Price it"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
