// modules/outreach/touch-batching.ts · client-side batch orchestration for
// selection-scoped touch generation (WP5-1).
//
// `generateTouchpointsAction` bounds ONE call at MAX_SELECTED_BUSINESSES (25)
// server-side (Zod .max(25) — the per-call scalability bound stays). But the
// leads bulk bar offers "Select all N filtered" with no cap, so Tom can pick
// 412 leads. Rather than fail post-hoc with a raw Zod array-max message, the
// overlay chunks the selection into sequential ≤25 batches and awaits each.
//
// Per-batch is clean: each server call mints its own synthetic runId and
// holds→settles its own credits independently, so a mid-sequence stop (e.g.
// insufficient_credits) leaves the already-settled batches intact and simply
// halts the rest. This module is PURE (no I/O) so it's unit-testable; the
// overlay owns the actual server calls + progress UI.

/** The per-call server cap (mirrors MAX_SELECTED_BUSINESSES in actions.ts). */
export const TOUCH_BATCH_SIZE = 25;

/** Split `ids` into ordered, ≤`size` chunks (order preserved so "top N by the
 *  current sort" batches deterministically). Empty in → empty out. */
export function chunkBusinessIds(
  ids: readonly string[],
  size: number = TOUCH_BATCH_SIZE,
): string[][] {
  const n = Math.max(1, Math.trunc(size));
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += n) {
    out.push(ids.slice(i, i + n));
  }
  return out;
}
