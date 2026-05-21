// Cron · shared batch helpers (canonical location).
//
// Re-exports the daily-cron batch primitives from their original landing
// site at `app/api/cron/daily/_lib/batch.ts` so both daily AND weekly
// handlers can import via a single root-relative path. The daily handlers
// continue to use the legacy in-folder path; new handlers (weekly,
// monthly) should import from here.
//
// Why a re-export instead of a relocation? The daily handlers shipped in
// C.8 (PR #32) with 7 test files mocking `../_lib/batch`. Moving the
// source would force a coordinated 14-file rename across handler routes
// and their tests. A re-export gives weekly handlers a clean canonical
// import without disturbing shipped tests.
//
// Follow-up (low priority): relocate the implementation here when a
// future handler edit touches the daily _lib path anyway.

export {
  resolveBatchLimit,
  runBatch,
  statusFromOutcome,
  type BatchOutcome,
} from "../daily/_lib/batch";
