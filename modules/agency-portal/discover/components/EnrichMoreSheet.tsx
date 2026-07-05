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
import {
  emitEnrichStarted,
  emitEnrichScope,
  type EnrichSheetRequest,
} from "../enrich-sheet-bus";

/** AUDIT U2/D5 · enrichment-type → workbench DataFamily, for per-cell "running"
 *  marks (services/ai_research have no table column → omitted). */
const ENRICH_TYPE_TO_FAMILY: Record<string, string> = {
  contacts: "contacts",
  tech: "website",
  lighthouse: "website",
  reviews: "reviews",
  meta_ads: "ads",
  google_ads: "ads",
  serp: "search",
};

type ScopeChoice = "selected" | "visible" | "all";

interface ScopeInfo {
  cellKeys: string[];
  marketCount: number;
  walletCredits: number;
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
  // AUDIT D1 · a single-field "— enrich" cell or a drawer ghost accordion opens
  // with its family PRE-CHECKED (request.preselect), so clicking one field
  // pre-selects that enrichment. The bulk "enrich more" / coverage CTA leaves
  // preselect false so the user isn't surprised by a big pre-selected bill.
  const [selected, setSelected] = useState<Set<EnrichmentType>>(() =>
    request.preselect && request.enrichments?.length
      ? new Set<EnrichmentType>(request.enrichments)
      : new Set<EnrichmentType>(),
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Deficit → the wallet can't cover the net quote (renders Add credits →).
  const [deficit, setDeficit] = useState<number | null>(null);
  const fetchedFor = useRef<string | null>(null);
  // U5 · the right-side panel element — scopes the Tab focus-trap so focus can't
  // escape behind the scrim to the workbench (a11y for role=dialog aria-modal),
  // matching the LeadDrawer pattern.
  const panelRef = useRef<HTMLDivElement | null>(null);

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

  // U5 · Escape closes (scrim click handled on the overlay) + Tab focus-trap +
  // initial focus into the panel + focus-return to the trigger on close, so the
  // right-side panel behaves as a proper role=dialog aria-modal (parity with
  // the LeadDrawer + the workbench help modal). Body scroll is locked while open.
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    // Lock body scroll so wheel/touch over the scrim can't scroll the workbench
    // behind the panel (restored exactly on close).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    const focusTimer = window.setTimeout(() => focusables()[0]?.focus(), 30);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (active && !panelRef.current?.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(focusTimer);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
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
  // Client-side GROSS estimate (CREDIT_PRICES) — shown live on the Run button
  // (audit D2). The server preflight at run-time returns the honest NET (fresh
  // units served from cache at 0 credits) and bills that — never more.
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

  // AUDIT D2 · ONE click: price server-side (honest net + fresh-cache dedup +
  // estimateId) and run in the same transition. The gross estimate already told
  // the user the ballpark on the Run button, so the old two-step "Price it →
  // Run" is gone. A wallet shortfall surfaces the exact deficit + Add-credits.
  function runNow() {
    if (!scopeInfo || enrichments.length === 0) return;
    setError(null);
    setDeficit(null);
    startTransition(async () => {
      const pf = await preflightEnrichAction({
        businessIds: scopeIds,
        cellKeys: scopeInfo.cellKeys,
        enrichments,
      });
      if (pf.status !== "ok") {
        setError(
          pf.status === "invalid_input"
            ? pf.message
            : `Couldn't price this (${pf.status}).`,
        );
        return;
      }
      if (pf.netCredits > scopeInfo.walletCredits) {
        setDeficit(pf.netCredits - scopeInfo.walletCredits);
        return;
      }
      const r = await runEnrichAction({ estimateId: pf.estimateId });
      if (r.status === "ok") {
        showToast("Enrichment started — leads update live as it runs");
        // AUDIT D4 · announce the new run so LiveRunGate shows the banner
        // OPTIMISTICALLY now, before router.refresh() brings the server run.
        emitEnrichStarted(r.runId);
        // AUDIT U2/D5 · flag the exact (business × family) cells as "running".
        emitEnrichScope({
          businessIds: scopeIds,
          families: [
            ...new Set(
              enrichments
                .map((e) => ENRICH_TYPE_TO_FAMILY[e])
                .filter((f): f is string => !!f),
            ),
          ],
        });
        router.refresh();
        onClose();
      } else if (r.status === "insufficient_credits") {
        setDeficit(r.netCredits - (scopeInfo?.walletCredits ?? 0));
      } else if (r.status === "needs_requote" || r.status === "quote_expired") {
        setError("The quote changed — try again.");
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
    // U5 · a right-side slide-in panel (was a centered modal). `.overlay.side`
    // is the same scrim; `.enrich-panel` docks full-height on the right and
    // slides in. On narrow viewports (<720px) the CSS falls the panel back to a
    // bottom-sheet so it stays reachable on mobile.
    <div
      className="overlay side"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="enrich-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="enrichMoreTitle"
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

          {/* AUDIT U20 · ALWAYS restate the exact run-set + its credit total
              before commit (not only when a dependency was pulled in) so the
              scans that will run — and what they cost — are never a surprise.
              When a pick pulls in a dependency (Tech rides the billed contacts
              scan) that's called out too. Uses the same grossCredits shown on
              the Run button. */}
          {enrichments.length > 0 ? (
            <p className="note" style={{ marginTop: 6 }}>
              Runs:{" "}
              {enrichments.map((e) => ENRICHMENT_PRICES[e].label).join(" + ")} ·
              ~{fmtCredits(grossCredits)} credits
              {enrichments.length > selected.size
                ? " — a dependency is pulled in."
                : ""}
            </p>
          ) : null}

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
            {enrichments.length === 0 || scopeCount + cellCount === 0 ? (
              "Pick at least one data family."
            ) : deficit != null && deficit > 0 ? (
              <>
                Needs <b>{fmtCredits(deficit)}</b> more credits
                {scopeInfo
                  ? ` · wallet ${fmtCredits(scopeInfo.walletCredits)}`
                  : ""}
                .
              </>
            ) : (
              <>
                ~{fmtCredits(grossCredits)} credits
                {scopeInfo
                  ? ` · wallet ${fmtCredits(scopeInfo.walletCredits)}`
                  : ""}{" "}
                · fresh-cache dedup applied at run
              </>
            )}
          </span>
          {deficit != null && deficit > 0 ? (
            <Link
              href={{
                pathname: "/team/billing",
                query: { deficit: String(Math.max(1, Math.ceil(deficit))) },
              }}
              className="btn primary"
            >
              Add credits →
            </Link>
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
              onClick={runNow}
            >
              {pending
                ? "Starting…"
                : `Run · ${fmtCredits(grossCredits)} credits`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
