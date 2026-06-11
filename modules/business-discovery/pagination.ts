/**
 * Discovery pagination math · pure, unit-tested.
 *
 * DataForSEO Business Listings caps a single call at 1000 rows but
 * supports `offset` pagination (sound up to ~10k results — far beyond
 * any city cell). The runner loops pages of ≤1000 until it has the
 * requested number, the cell is exhausted (short page), or DfS's
 * `total_count` says there is nothing left.
 *
 * Observed Live-tier billing (verified against DiscoveryRun history
 * 2026-05-26): ~$0.01 base per call + ~$0.0003 per returned listing.
 * A full 5000-row pull = 5 pages ≈ $1.55 — comfortably under the $5
 * single-call approval ceiling in `docs/permissions.md`.
 */

/** DataForSEO hard cap per Business Listings call. */
export const DFS_PAGE_SIZE = 1000;

/**
 * Runner cap per discovery run = DfS's offset-pagination ceiling
 * (10 pages × 1000). Big enough to fully cover the densest
 * (category × city × radius) cell we'd ever track — "all companies,
 * even in a loaded huge city". Worst case ≈ $3.10, under the $5
 * approval ceiling.
 *
 * Runtime safety: the runner CHECKPOINTS after every page (run counts +
 * cell aggregates persist incrementally), so even if a fully-new 10k
 * pull outruns Vercel's 300s action budget, nothing is lost — re-click
 * resumes cheaply (24h KV page cache = free re-fetch, batch dedup
 * fast-forwards past already-persisted rows).
 */
export const MAX_DISCOVERY_LIMIT = 10_000;

export const DEFAULT_DISCOVERY_LIMIT = 100;

/** Clamp an admin-supplied limit into [1, MAX_DISCOVERY_LIMIT]. */
export function clampLimit(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_DISCOVERY_LIMIT;
  return Math.min(Math.max(1, Math.floor(raw)), MAX_DISCOVERY_LIMIT);
}

/**
 * Size of the next page to request, or 0 to stop.
 *
 * `totalAvailable` is DfS's `total_count` — null before the first page
 * lands. Once known, we never request past it. The caller must ALSO
 * stop when a page comes back short (returned < requested), which
 * covers cells where total_count is missing or overstated.
 */
export function nextPageLimit(state: {
  requestedLimit: number;
  fetched: number;
  totalAvailable: number | null;
}): number {
  let remaining = state.requestedLimit - state.fetched;
  if (state.totalAvailable !== null) {
    remaining = Math.min(remaining, state.totalAvailable - state.fetched);
  }
  if (remaining <= 0) return 0;
  return Math.min(remaining, DFS_PAGE_SIZE);
}

/**
 * Worst-case cost estimate for a discovery pull of `n` rows, from the
 * observed billing model (base per call + per-row). Actual cost is
 * lower when the cell has fewer rows than requested; the adapter
 * always bills DfS's reported `task.cost`, this is display-only.
 */
export function estimateDiscoveryCostUsd(n: number): number {
  const pages = Math.max(1, Math.ceil(n / DFS_PAGE_SIZE));
  return pages * 0.01 + n * 0.0003;
}
