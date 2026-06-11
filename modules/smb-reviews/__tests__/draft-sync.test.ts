/**
 * draft-sync · the pure adopt-or-not decision behind AIReplyDraftBody's
 * prop-sync effect (the fix for "generated reply only appears after a
 * page reload").
 *
 * Per `.claude/rules/testing.md` — invariants, not coverage:
 *   1. A freshly arrived draft IS adopted when the textarea still shows
 *      the previous draft (incl. the empty initial state).
 *   2. In-progress owner edits are NEVER clobbered by an incoming draft.
 *   3. Empty/blank incoming drafts never blank the editor.
 *   4. Re-renders with an already-adopted draft are no-ops (no loops).
 */
import { describe, expect, test } from "vitest";

import { shouldAdoptIncomingDraft } from "../draft-sync";

describe("shouldAdoptIncomingDraft", () => {
  test("adopts a fresh draft when the editor is untouched (mounted empty)", () => {
    // Viktor's bug path: panel mounted with no draft, generation finishes,
    // the lifted draft arrives via props — must render without a reload.
    expect(
      shouldAdoptIncomingDraft("", "Thanks so much for the kind words!", ""),
    ).toBe(true);
  });

  test("adopts a NEWER draft when the editor still shows the previous one", () => {
    expect(
      shouldAdoptIncomingDraft("old draft", "new draft", "old draft"),
    ).toBe(true);
  });

  test("never clobbers in-progress edits", () => {
    // Owner typed since the last applied draft — incoming must lose.
    expect(
      shouldAdoptIncomingDraft("old draft", "new draft", "old draft + my edit"),
    ).toBe(false);
    // Even when the editor started empty and the owner typed from scratch.
    expect(shouldAdoptIncomingDraft("", "new draft", "my own words")).toBe(
      false,
    );
  });

  test("no-op when the incoming draft is already applied", () => {
    expect(shouldAdoptIncomingDraft("same", "same", "same")).toBe(false);
  });

  test("blank or missing incoming drafts never blank the editor", () => {
    expect(shouldAdoptIncomingDraft("old", null, "old")).toBe(false);
    expect(shouldAdoptIncomingDraft("old", undefined, "old")).toBe(false);
    expect(shouldAdoptIncomingDraft("old", "   ", "old")).toBe(false);
    expect(shouldAdoptIncomingDraft("", "", "")).toBe(false);
  });
});
