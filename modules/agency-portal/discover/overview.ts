// modules/agency-portal/discover/overview.ts · the "Research overview" data
// layer (Phase 9 · §4.19/4.20). Turns a discovery's raw-list summary + the
// cell's CellMetric into the comprehension strip rendered above the raw table:
// cohort tiles, the cell-standards reference panel, and a distribution sparkline.
// Read-only (select-only); all math is pure so the shape is unit-testable.

import prisma from "@/lib/prisma";
import { parseCellKey } from "@/lib/cell";
import type { Tone } from "./visual-helpers";
import type { CellStandardRow } from "./components/CellStandardsPanel";

export interface OverviewCohort {
  pitch: string;
  count: number;
  reachableCount?: number;
  tone: Tone;
  toneLabel: string;
  footnote?: string;
}

export interface ResearchOverview {
  cohorts: OverviewCohort[];
  /** Human cell name for the standards panel, e.g. "medical spa · miami". */
  cellLabel: string;
  standardRows: CellStandardRow[];
  sampleSize: number;
  /** p10→p90 of the headline metric (reviewCount) for the distribution sparkline. */
  distributionSeries: number[];
}

interface RawSummary {
  total: number;
  reachable: number;
  phoneOnly: number;
  hidden: number;
}

interface Breakpoints {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

/** Build the cohort tiles purely from the reachability summary counts. */
export function buildCohorts(summary: RawSummary): OverviewCohort[] {
  return [
    {
      pitch: "Full market — the complete cell, unenriched",
      count: summary.total,
      reachableCount: summary.reachable,
      tone: "indigo",
      toneLabel: "Raw",
    },
    {
      pitch: "Reachable now — has a usable contact channel",
      count: summary.reachable,
      tone: "green",
      toneLabel: "Workable",
      footnote: `${summary.phoneOnly.toLocaleString()} phone-only`,
    },
    {
      pitch: "Hidden — listing-only or unreachable",
      count: summary.hidden,
      tone: "red",
      toneLabel: "Suppressed",
      footnote: "default-hidden; never enriched",
    },
  ];
}

/** Map a CellMetric `distributions` blob into the standards rows + a sparkline
 *  series. Pure — exported for testing. Median (p50) is the reference value. */
export function buildStandards(distributions: unknown): {
  standardRows: CellStandardRow[];
  distributionSeries: number[];
} {
  const d = (distributions ?? {}) as Record<string, Breakpoints | undefined>;
  const mk = (
    label: string,
    key: string,
    unit?: string,
    help?: string,
  ): CellStandardRow | null => {
    const b = d[key];
    if (!b) return null;
    return {
      label,
      value: b.p50, // the cell's typical value is the reference
      p10: b.p10,
      p25: b.p25,
      p50: b.p50,
      p75: b.p75,
      p90: b.p90,
      percentile: 50,
      unit,
      help,
    };
  };
  const standardRows = [
    mk(
      "Reviews",
      "reviewCount",
      undefined,
      "Typical review count in this cell",
    ),
    mk("Rating", "rating", "★"),
    mk("Review velocity", "velocity", "/mo"),
  ].filter((r): r is CellStandardRow => r !== null);

  const rc = d["reviewCount"];
  const distributionSeries = rc ? [rc.p10, rc.p25, rc.p50, rc.p75, rc.p90] : [];
  return { standardRows, distributionSeries };
}

/**
 * Assemble the overview for a discovery. Reads CellMetric for the first cell
 * (the headline cell); falls back to an empty standards panel ("limited
 * sample") when no metric exists yet.
 */
export async function getResearchOverview(input: {
  cellKeys: string[];
  summary: RawSummary;
}): Promise<ResearchOverview> {
  const cohorts = buildCohorts(input.summary);

  const firstKey = input.cellKeys[0];
  const parsed = firstKey ? parseCellKey(firstKey) : null;
  if (!parsed) {
    return {
      cohorts,
      cellLabel: "this market",
      standardRows: [],
      sampleSize: 0,
      distributionSeries: [],
    };
  }

  const cellLabel = `${parsed.categorySlug.replace(/_/g, " ")} · ${parsed.metroSlug.replace(/_/g, " ")}`;

  const metric = await prisma.cellMetric.findFirst({
    where: { cellKey: firstKey },
    select: { sampleSize: true, distributions: true },
  });

  if (!metric) {
    return {
      cohorts,
      cellLabel,
      standardRows: [],
      sampleSize: 0,
      distributionSeries: [],
    };
  }

  const { standardRows, distributionSeries } = buildStandards(
    metric.distributions,
  );
  return {
    cohorts,
    cellLabel,
    standardRows,
    sampleSize: metric.sampleSize,
    distributionSeries,
  };
}
