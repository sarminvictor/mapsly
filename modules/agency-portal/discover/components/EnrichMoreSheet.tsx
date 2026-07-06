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
import { type EnrichmentType } from "@/modules/cost/pricing";
import {
  preflightEnrichAction,
  runEnrichAction,
} from "@/modules/discovery/enrich-actions";
import { getEnrichScopeAction } from "../enrich-scope-actions";
import { resolveResearches } from "../researches";
import { fmtCredits } from "../flow-types";
import {
  DATA_GROUPS,
  ENRICHMENT_TYPE_KEYS,
  enrichTypesForGroups,
  groupCellCredits,
  groupLeadCredits,
  rollUpGroupState,
  type DataGroup,
  type DataGroupKey,
  type EnrichmentTypeKey,
  type TypeState,
} from "../family-coverage";
import {
  emitEnrichStarted,
  emitEnrichScope,
  type EnrichSheetRequest,
} from "../enrich-sheet-bus";

type ScopeChoice = "selected" | "visible" | "all";

interface ScopeInfo {
  cellKeys: string[];
  marketCount: number;
  walletCredits: number;
}

/**
 * The per-group, per-scope enrichment picture the sheet renders: how many of the
 * scope's leads already HAVE every type in the group (all enriched), how many
 * are still TO GET (≥1 type not yet run), and the group's credit price for the
 * to-get set. Market groups (Meta / SERP) don't count per-lead — they run once
 * per cell — so `isMarket` flips the row to "market · runs once · N cr".
 */
interface GroupLine {
  group: DataGroup;
  /**
   * Leads where the group's rolled-up state is anything BUT `not_run` — the group
   * has been dealt with (enriched, ran-but-empty, in-flight, or attempted-and-
   * failed). A completed-but-empty enrichment reads as HAVE, not to-get.
   */
  have: number;
  /** Leads where the rolled-up group state is `not_run` (the only true to-get). */
  toGet: number;
  /** Credits for this group over the to-get set (per-lead) or per cell — 0 when
   *  the group is already done for this scope (nothing to run, nothing to bill). */
  credits: number;
  /** True for a per-cell (market) group — priced/scoped per cell, not per lead. */
  isMarket: boolean;
  /** Already done for THIS scope: nothing left to get + ≥1 lead touched. For a
   *  market group this means the cell run(s) completed OK — re-runs are offered
   *  only after a FAILED run (issue 12). */
  done: boolean;
}

/** Map a set of pre-selected enrichment-type tokens (from a single-field / ghost
 *  accordion CTA) to the DATA GROUPS they belong to, so the sheet opens with the
 *  right GROUP checked (a Lighthouse cell → "Site speed & SEO"). */
function groupsForEnrichTypes(
  types: readonly EnrichmentType[],
): DataGroupKey[] {
  const want = new Set<string>(types);
  const out: DataGroupKey[] = [];
  for (const g of DATA_GROUPS) {
    const tokens = enrichTypesForGroups([g.key]);
    if (tokens.some((t) => want.has(t))) out.push(g.key);
  }
  return out;
}

export function EnrichMoreSheet({
  discoveryId,
  request,
  coverageTypeStates = {},
  onClose,
}: {
  discoveryId: string;
  request: EnrichSheetRequest;
  /**
   * The per-business per-TYPE run-state map (from the page, via EnrichMoreHost)
   * — lets the sheet compute "N have · M to get" per data group over the
   * scope's leads. A business absent from the map counts as fully not-run.
   */
  coverageTypeStates?: Record<string, Record<EnrichmentTypeKey, TypeState>>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [scopeInfo, setScopeInfo] = useState<ScopeInfo | null>(null);
  const [scopeError, setScopeError] = useState(false);
  // AUDIT D1 + ISSUE-2 · a single-field "— enrich" cell, a drawer ghost
  // accordion, AND the toolbar/bulk-bar buttons open with their data GROUPS
  // PRE-CHECKED (request.preselect) — the buttons advertise a priced basket,
  // so the sheet must open matching it. Only the un-priced coverage CTA
  // leaves preselect false.
  const [selected, setSelected] = useState<Set<DataGroupKey>>(() =>
    request.preselect && request.enrichments?.length
      ? new Set<DataGroupKey>(groupsForEnrichTypes(request.enrichments))
      : new Set<DataGroupKey>(),
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

  // Memoized so the per-group `groupLines` useMemo doesn't see a fresh array
  // reference on every render (the "all" branch would otherwise be a new []).
  const scopeIds = useMemo(
    () =>
      scope === "selected"
        ? selectedIds
        : scope === "visible"
          ? visibleIds
          : [],
    [scope, selectedIds, visibleIds],
  );
  const scopeCount =
    scope === "all" ? (scopeInfo?.marketCount ?? 0) : scopeIds.length;
  const cellCount = scopeInfo?.cellKeys.length ?? 0;

  // The enrichment-type tokens the selected data GROUPS map to (Ad activity →
  // meta_ads + google_ads, Contacts & site tech → contacts + tech, …), then
  // dependency-resolved (tech → +contacts) exactly like the get-leads flow, so
  // the sheet quotes + bills the same families the dispatch will run.
  const selectedTypeTokens = useMemo(
    () => enrichTypesForGroups([...selected]) as EnrichmentType[],
    [selected],
  );
  const enrichments = useMemo(
    () => resolveResearches(selectedTypeTokens),
    [selectedTypeTokens],
  );
  // Per data-group × per-scope picture: for the CURRENT scope's leads, how many
  // already HAVE the whole group vs still to GET it, and the group's credit
  // price for the to-get set. Market groups (Meta/SERP) are quoted per cell.
  const groupLines = useMemo((): GroupLine[] => {
    return DATA_GROUPS.map((group) => {
      const isMarket = group.basis === "market";
      let have = 0;
      let toGet = 0;
      for (const id of scopeIds) {
        const ts = coverageTypeStates[id];
        // Build the full per-TYPE map (every one of the 9 keys, default not_run)
        // and roll it up through the CANONICAL precedence so the popup agrees
        // with the drawer/dot-strip. "to get" = never ran (not_run) OR the scan
        // FAILED (re-offerable for retry — a failed scan is NOT "already done").
        // enriched / ran-but-empty / in-flight all count as HAVE (a
        // completed-but-empty enrichment must NOT read as "to get" — that was the
        // exact bug; the server preflight dedups already-fresh units at run so a
        // retry only re-bills the failed half).
        const perType = {} as Record<EnrichmentTypeKey, TypeState>;
        for (const k of ENRICHMENT_TYPE_KEYS) perType[k] = ts?.[k] ?? "not_run";
        const state = rollUpGroupState(perType, group);
        if (state === "not_run" || state === "failed") toGet += 1;
        else have += 1;
      }
      // ISSUE-12 · "already done" now applies to MARKET groups too: the per-lead
      // states already fold the cell-scoped AdMarketRun (a completed cell run
      // reads enriched/empty on every lead in it), so toGet===0 && have>0 means
      // the market run completed and didn't fail — nothing to run, 0 credits.
      // A FAILED cell run leaves its leads in `failed` → toGet>0 → the row keeps
      // quoting the per-cell price as the retry affordance. scope==="all" has no
      // per-lead ids, so done stays false and the row quotes the estimate.
      const done = toGet === 0 && have > 0;
      // Per-lead count to bill: the to-get set (selected/visible scope), or the
      // whole market when scope is "all" (no per-lead ids to split on).
      const leadN = scope === "all" ? scopeCount : toGet;
      // Credits = per-cell types × cells + per-lead types × leads. Meta and
      // Google are separate groups now (Meta 4/cell, Google 1/lead), so in
      // practice one term is 0 — the formula stays general either way.
      const credits = done
        ? 0
        : groupCellCredits(group) * cellCount + groupLeadCredits(group) * leadN;
      return { group, have, toGet, credits, isMarket, done };
    });
    // scope === "all" has no per-lead ids (server resolves the market) → the
    // have/toGet split is unavailable; credits fall back to the whole-scope
    // count so the row still quotes an estimate.
  }, [scopeIds, coverageTypeStates, cellCount, scopeCount, scope]);

  // ISSUE-1 · the number on the Run button + footer is the client NET over the
  // SELECTED groups — the same toGet-based netting the rows show (the old code
  // multiplied CREDIT_PRICES by the FULL scope, quoting ~10 cr over 10 leads
  // whose only selected group was already done). The server preflight remains
  // the authoritative billed net; this estimate converges to it.
  const netCredits = useMemo(
    () =>
      groupLines
        .filter((l) => selected.has(l.group.key))
        .reduce((s, l) => s + l.credits, 0),
    [groupLines, selected],
  );
  // Everything selected is already done → nothing would run, nothing billed.
  const nothingToRun = enrichments.length > 0 && netCredits === 0;

  function toggle(key: DataGroupKey) {
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
    setSelected(new Set(DATA_GROUPS.map((g) => g.key)));
    setError(null);
    setDeficit(null);
  }

  function deselectAll() {
    setSelected(new Set());
    setError(null);
    setDeficit(null);
  }

  const allSelected = selected.size === DATA_GROUPS.length;

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
        // AUDIT U2/D5 + ISSUE-11 · flag the exact (business × type) cells as
        // "running". Raw type tokens (not the lossy family collapse) so sibling
        // columns don't cross-light and services/ai_research light too; `all`
        // covers the whole-research scope (scopeIds is empty there — the old
        // emit silently no-oped and nothing lit).
        emitEnrichScope({
          businessIds: scopeIds,
          types: [...enrichments],
          all: scope === "all",
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

          {/* Data-group header + bulk select controls. The sheet speaks the ONE
              user-facing vocabulary — the 7 DATA GROUPS (what Tom GETS), never
              the 9 billing jobs. */}
          <div
            className="setrow"
            style={{ marginBottom: 2, alignItems: "baseline" }}
          >
            <span className="setl">Data to get</span>
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

          {/* Data-group rows — a leading status dot (solid = already done for
              this scope), the DATA the user gets, a green "N have" pill, the
              muted description, and a fixed right-side cluster reading "already
              done" or "{N} to get · {credits} cr". Market groups (Meta/SERP)
              run once per cell; the market note rides the description line.
              "Contacts & site tech" is ONE row (contacts + tech are one fetch). */}
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {groupLines.map(
              ({ group, have, toGet, credits, isMarket, done }) => {
                const on = selected.has(group.key);
                return (
                  <li key={group.key}>
                    <label className="enrich-group-row">
                      <span
                        className={`egr-dot${done ? " on" : ""}`}
                        aria-hidden="true"
                      />
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(group.key)}
                      />
                      <span className="egr-main">
                        <span className="egr-head">
                          <span className="egr-label">{group.label}</span>
                          {have > 0 ? (
                            <span className="egr-have-pill">
                              {have.toLocaleString()} have
                            </span>
                          ) : null}
                        </span>
                        <span className="note egr-desc">
                          {group.desc}
                          {group.marketNote ? ` · ${group.marketNote}` : ""}
                        </span>
                      </span>
                      <span className="egr-todo" style={{ flexShrink: 0 }}>
                        {/* ISSUE-12 · a market group whose cell run(s) completed
                          reads "already done" like every other group — rerun is
                          offered only when the previous run FAILED (its leads
                          read `failed` → toGet>0 → the quote returns). */}
                        {done ? (
                          "already done"
                        ) : isMarket ? (
                          // "market · runs once per cell" already rides the
                          // desc line (marketNote) — don't say it twice.
                          <>
                            runs once ·{" "}
                            <span className="ic-coin sm" aria-hidden="true" />
                            {fmtCredits(credits)} cr
                          </>
                        ) : scope === "all" ? (
                          <>
                            {scopeCount.toLocaleString()} leads ·{" "}
                            <span className="ic-coin sm" aria-hidden="true" />
                            {fmtCredits(credits)} cr
                          </>
                        ) : (
                          <>
                            {toGet.toLocaleString()} to get ·{" "}
                            <span className="ic-coin sm" aria-hidden="true" />
                            {fmtCredits(credits)} cr
                          </>
                        )}
                      </span>
                    </label>
                  </li>
                );
              },
            )}
          </ul>

          {/* AUDIT U20 · ALWAYS restate the exact data groups that will run + the
              credit total before commit, so what gets fetched — and what it
              costs — is never a surprise. Speaks the data-group vocabulary. The
              container ALWAYS renders (empty text when nothing's picked) so it
              reserves height and never pops in (FIX 3a · no layout jump). */}
          <p className="note egr-getting" style={{ marginTop: 6 }}>
            {selected.size > 0
              ? nothingToRun
                ? `Getting: ${[...selected]
                    .map(
                      (k) => DATA_GROUPS.find((g) => g.key === k)?.label ?? k,
                    )
                    .join(" + ")} — already done, nothing to run`
                : `Getting: ${[...selected]
                    .map(
                      (k) => DATA_GROUPS.find((g) => g.key === k)?.label ?? k,
                    )
                    .join(" + ")} · ~${fmtCredits(netCredits)} credits`
              : ""}
          </p>

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
          {/* FIX 3b · ONE stable wrapper — the three length-variants swap as
              text/children INSIDE it (never mount/unmount the span) so the
              footer can't pop; the .egr-foot-msg min-height (agency-portal.css)
              reserves the tallest variant's height. */}
          <span className="note egr-foot-msg" style={{ flex: 1, minWidth: 0 }}>
            {enrichments.length === 0 || scopeCount + cellCount === 0 ? (
              "Pick at least one data group."
            ) : deficit != null && deficit > 0 ? (
              <>
                Needs <b>{fmtCredits(deficit)}</b> more credits
                {scopeInfo
                  ? ` · wallet ${fmtCredits(scopeInfo.walletCredits)}`
                  : ""}
                .
              </>
            ) : nothingToRun ? (
              // ISSUE-1 · every selected group is already done for this scope —
              // running would fetch nothing and bill nothing, so don't offer it.
              "Everything selected is already done — nothing to run."
            ) : (
              <>
                ~{fmtCredits(netCredits)} credits (estimate)
                {scopeInfo
                  ? ` · wallet ${fmtCredits(scopeInfo.walletCredits)}`
                  : ""}{" "}
                · already-fresh data is free — you&apos;re billed the net at run
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
                (scopeCount === 0 && cellCount === 0) ||
                // ISSUE-1 · net 0 = everything selected is already done. The
                // backend would skip every unit and bill 0 (confirmed:
                // SKIPPED_FRESH at dispatch, netted at quote, clamped at
                // settle) — so the button must not offer a no-op run.
                nothingToRun
              }
              onClick={runNow}
            >
              {pending
                ? "Starting…"
                : nothingToRun
                  ? "Nothing to run"
                  : `Run · ~${fmtCredits(netCredits)} credits`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
