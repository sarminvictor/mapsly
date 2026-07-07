// WorkspaceHeader · the discovery workspace's title block (WP4-14).
//
// Leads with the RESEARCH GOAL and a market NARRATIVE, not a truncation
// warning. Before: "Showing first 200 of 412" read as an apology for a cap.
// After: the goal is an indigo pill next to the title, and the count is phrased
// as context — "the 412 med spas in this market · showing 200" — so what Tom
// sees is "here's your whole market, here's the slice on screen", not "we hid
// things from you".
//
// Presentational only — all data is resolved server-side and passed as plain
// props (no functions cross the boundary · cache-components.md Pattern 4). Both
// workbench pages (app/[locale]/(agency)/discover/[discoveryId]/page.tsx and
// its lists/[listId] sibling) render <WorkspaceHeader …/> in place of their old
// inline <header> blocks. This keeps the goal-pill + narrative in one reusable
// place. The freshness presentation (dot class + label + color) is derived HERE
// from the raw FreshnessState so both pages share one mapping.
//
// Per `.claude/rules/ui-ux-agency.md`: dense, numbers over adjectives,
// jargon-OK. English-only.

import type { ComponentProps } from "react";

import { Link } from "@/i18n/navigation";
import type { FreshnessState } from "@/lib/cell";
import { FreshnessChip } from "./FreshnessChip";

type LinkHref = ComponentProps<typeof Link>["href"];

export interface WorkspaceHeaderProps {
  /** "{Category} · {Metro}" (or the discovery name / "Workspace" fallback). */
  title: string;
  /** The research goal label (e.g. "Website rebuild"), or null if none. */
  goalName?: string | null;
  /** Rows on screen (the fetched window). */
  showing: number;
  /** Whole-set size (Business rows across the discovery's cells / list leads). */
  total: number;
  /** AUDIT B2/B3 · the TRUE market (every business in the cells, ungated). When
   *  provided, the header renders the defined counts strip instead of the prose
   *  narrative so market ≠ enrichable ≠ enriched ≠ shown is explicit on screen. */
  marketTotal?: number;
  /** AUDIT B2/B3 · the ENRICHABLE set (website-having) for a site-dependent goal
   *  — the number the workbench window actually shows. Omitted when the goal
   *  doesn't gate on a website (then market == enrichable). */
  enrichable?: number;
  /** AUDIT B2/B3 · leads an enrichment has actually run on (what was paid for). */
  enriched?: number;
  /** Whether `enriched` is exact (whole market covered) vs a floor (window cap).
   *  When false the header renders "≥ N" so an undercount never reads as truth. */
  enrichedExact?: boolean;
  /**
   * Plural market noun for the narrative — e.g. "med spas". Pass the category
   * label lowercased + pluralized by the page; falls back to "businesses".
   */
  marketNoun?: string;
  /** Container noun for the narrative — "market" (default) or "list". */
  scopeNoun?: string;
  /** Raw freshness state — the dot/label/color presentation derives here. */
  freshness: FreshnessState;
  /** "2 days ago" — when the market was mapped. */
  mappedRelative: string;
  /** Whole credits spent to date on this research. */
  credits: number;
  /** Back-nav target. Defaults to the research directory. */
  backHref?: LinkHref;
  /** Optional trailing meta segment (e.g. "Hot med spas · website rebuild"). */
  extra?: string | null;
}

/** FreshnessState → dot modifier + label + color (the prototype meta line). */
export function freshnessHeaderParts(state: FreshnessState): {
  dot: string;
  label: string;
  color: string;
} {
  switch (state) {
    case "fresh":
      return { dot: "fresh", label: "Fresh", color: "var(--green)" };
    case "aging":
      return { dot: "aging", label: "Aging", color: "var(--amber)" };
    case "stale":
      return { dot: "stale", label: "Stale", color: "var(--red)" };
    default:
      return { dot: "new", label: "Not mapped", color: "var(--faint)" };
  }
}

export function WorkspaceHeader({
  title,
  goalName,
  showing,
  total,
  marketTotal,
  enrichable,
  enriched,
  enrichedExact = true,
  marketNoun = "businesses",
  scopeNoun = "market",
  freshness,
  mappedRelative,
  credits,
  backHref = { pathname: "/research" },
  extra,
}: WorkspaceHeaderProps) {
  // Narrative-first count: lead with the whole market, then the on-screen slice.
  // Only mention "showing N" when we actually capped — otherwise it's just the count.
  const narrative =
    total > showing
      ? `the ${total.toLocaleString()} ${marketNoun} in this ${scopeNoun} · showing ${showing.toLocaleString()}`
      : `${total.toLocaleString()} ${marketNoun} in this ${scopeNoun}`;

  return (
    <header className="section">
      <Link href={backHref} className="lk">
        ← All research
      </Link>
      <h1
        style={{
          // AUDIT U14 · tighten the editorial masthead — a smaller headline +
          // less margin recovers ~2 grid rows for the data (the dense audience
          // wants the table, not a magazine title).
          marginTop: 2,
          fontSize: "1.4rem",
          lineHeight: 1.2,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        {title}
        {goalName ? (
          <span
            className="pill indigo"
            style={{ fontSize: 12, fontWeight: 600 }}
          >
            {goalName}
          </span>
        ) : null}
      </h1>
      <p
        className="note"
        style={{
          marginTop: 6,
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        {/* The defined counts strip — every number labelled + a hover
            explaining it, so "Why 57?" answers itself: market ≠ with-a-website
            ≠ enriched (you paid for). The old "Websites only · goal",
            "Closed & hidden excluded" and "Data as of" context chips (a
            separate row below the toolbar, duplicating the title + this
            freshness) are absorbed here as the count labels + their tips —
            owner 2026-07-06 masthead consolidation. */}
        {marketTotal != null ? (
          <span
            style={{
              display: "inline-flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "baseline",
            }}
          >
            <span
              data-tip={`Open, unhidden ${marketNoun} in this ${scopeNoun} only — closed and hidden businesses are excluded before any filter runs`}
            >
              <b>{marketTotal.toLocaleString()}</b> market
            </span>
            {enrichable != null ? (
              <span data-tip="Businesses with a website — the ones this goal can read. The rest are excluded because the goal needs a site to enrich.">
                · <b>{enrichable.toLocaleString()}</b> with a website
              </span>
            ) : null}
            <span
              data-tip={
                enrichedExact
                  ? "Leads an enrichment has actually run on — what you spent credits on"
                  : "Leads an enrichment has run on, counted across the loaded window (a floor — the true number may be higher)"
              }
            >
              ·{" "}
              <b>
                {enrichedExact ? "" : "≥ "}
                {(enriched ?? 0).toLocaleString()}
              </b>{" "}
              enriched
            </span>
            {/* "shown" only when the table is windowed (total > loaded) — the
                one number worth keeping from the retired context strip. When
                the whole set is on screen it's noise, so it's omitted. */}
            {total > showing ? (
              <span data-tip="Rows on screen now — the loaded window. The pager crosses windows.">
                · <b>{showing.toLocaleString()}</b> shown
              </span>
            ) : null}
            <span aria-hidden="true">·</span>
          </span>
        ) : (
          <span>{narrative} ·</span>
        )}
        {/* WP6-9 · the FreshnessChip carries the cell-freshness + $0-to-serve
            trust story in one chip (supersedes the bare dot+label). */}
        <FreshnessChip state={freshness} />
        {/* "mapped X ago" IS the data-as-of anchor (the retired context chip
            duplicated it); credits carry their own coin, so "spend to date" was
            redundant labelling. */}
        <span>· mapped {mappedRelative} ·</span>{" "}
        <span className="cr" data-tip="Credits spent on this research to date">
          <span className="ic-coin sm" aria-hidden="true" />
          {credits.toLocaleString()} credits
        </span>
        {extra ? ` · ${extra}` : null}
      </p>
    </header>
  );
}
