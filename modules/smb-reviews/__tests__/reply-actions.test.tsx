/**
 * ReplyActions · static-markup invariants for the generate→post swap.
 *
 * The fresh-draft fix flips `hasDraft` client-side the moment generation
 * succeeds (ReviewCard lifts the draft via onGenerated). These tests pin
 * the two button-row states that swap on that flag:
 *   - hasDraft=false → Generate button, no Post link.
 *   - hasDraft=true  → Post-to-Google link, no Generate button.
 *
 * Rendered via `react-dom/server` (node env, no jsdom) — effects don't
 * run here, so the onGenerated effect's decision logic is covered by the
 * pure-helper tests in draft-sync.test.ts + typecheck on the wiring.
 * The server-actions module is mocked: it pulls prisma/auth/next-cache,
 * none of which exist in the unit-test environment.
 */
import { describe, expect, test, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/[locale]/(smb)/reviews/actions", () => ({
  regenerateReplyAction: vi.fn(async () => ({
    ok: true as const,
    data: { draftEn: "draft", draftEs: "", voiceNotesSampleCount: 0 },
  })),
}));

import { ReplyActions } from "../components/ReplyActions";

const labels = {
  generate: "Generate reply",
  post: "Post to Google",
  skip: "Skip",
  unskip: "Restore",
};

const baseProps = {
  reviewId: "rev_1",
  googleReviewsUrl: "https://search.google.com/local/reviews?placeid=abc",
  isSkippedTab: false,
  onMove: () => {},
  labels,
};

describe("ReplyActions · button row per hasDraft", () => {
  test("hasDraft=true renders the Post-to-Google link (no Generate button)", () => {
    const html = renderToStaticMarkup(
      <ReplyActions {...baseProps} hasDraft={true} />,
    );
    expect(html).toContain("Post to Google");
    expect(html).toContain(
      "https://search.google.com/local/reviews?placeid=abc",
    );
    expect(html).not.toContain("Generate reply");
  });

  test("hasDraft=false renders the Generate button (no Post link)", () => {
    const html = renderToStaticMarkup(
      <ReplyActions {...baseProps} hasDraft={false} />,
    );
    expect(html).toContain("Generate reply");
    expect(html).not.toContain("Post to Google");
  });

  test("hasDraft=true without a Google URL renders neither CTA (queue only)", () => {
    const html = renderToStaticMarkup(
      <ReplyActions {...baseProps} hasDraft={true} googleReviewsUrl={null} />,
    );
    expect(html).not.toContain("Post to Google");
    expect(html).not.toContain("Generate reply");
    expect(html).toContain("Skip");
  });
});
