/**
 * draft-sync · pure decision helper for AIReplyDraftBody's textarea.
 *
 * The textarea owns its text via useState, so a draft that arrives AFTER
 * mount (freshly generated reply lifted through ReviewCard, or a newer
 * server payload post-revalidation) doesn't render on its own. A sync
 * effect adopts the incoming draft — but ONLY when doing so can't clobber
 * the owner's in-progress edits.
 *
 * Extracted as a pure function (instead of living inline in the effect)
 * because the module's component tests are static-markup renders — no
 * effects run there. The decision logic is unit-tested directly; the
 * effect wiring is covered by typecheck.
 *
 * @param lastApplied  The draft text last applied INTO the textarea
 *                     (initial prop at mount, or the last adopted value).
 * @param incoming     The draft prop as currently passed by the parent.
 * @param currentText  What the textarea shows right now.
 */
export function shouldAdoptIncomingDraft(
  lastApplied: string,
  incoming: string | null | undefined,
  currentText: string,
): boolean {
  const next = incoming ?? "";
  // Nothing to adopt — never blank out an editor over a missing draft.
  if (!next.trim()) return false;
  // Already showing this draft — adopting again would be a no-op loop.
  if (next === lastApplied) return false;
  // The owner typed since the last applied draft — NEVER clobber edits.
  if (currentText !== lastApplied) return false;
  return true;
}
