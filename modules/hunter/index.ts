/**
 * Hunter module · public surface · D.4
 *
 * Import from here, not from internal files. The cron handler (Phase 3),
 * the Hunter live-preview API (F.2), the list-detail page (F.3), and the
 * prospect-detail page (F.4) all read from this barrel.
 */

export type {
  EvaluationRow,
  FilterSpec,
  ModelName,
  RefreshDelta,
  RowVerdict,
  RowVerdictTrace,
} from "./types";

export {
  evaluateRow,
  evaluateRows,
  evaluateRowsWithTrace,
  evaluateSpec,
  evaluateSpecWithTrace,
  isKnownModel,
  MODEL_TO_SLOT,
  parseColumnRef,
  resolveColumnValue,
} from "./evaluate";

export {
  CADENCE_RANK,
  computeRefreshDelta,
  describeSpec,
  hasChangedSince,
  selectChangedCandidates,
  strictestCadence,
  type ChangeCandidate,
  type SpecSummary,
} from "./incremental";
