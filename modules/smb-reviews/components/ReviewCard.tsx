import * as React from "react";

import { Pill } from "@/components/ui";
import { AIReplyDraftBody } from "./AIReplyDraftBody";
import { StarRating } from "./StarRating";
import type { ReviewItem } from "../types";

/**
 * ReviewCard · single review on the SMB reviews page.
 *
 * Maria-facing card. Renders the review, the urgency state, the
 * AI-drafted reply (if available), and a primary "Post to Google" CTA.
 *
 * Per `.claude/rules/ui-ux-smb.md`:
 *   - Warm cream surface with coral accent for urgent rows
 *   - Plain-English status pill ("Unanswered · 6d") — no acronyms
 *   - Per-review math visible (`prior reviewer count · est. impact`)
 *
 * Per `.claude/rules/accessibility.md`:
 *   - Card uses `<article>` for landmark semantics
 *   - Star rating has an aria-label so AT reads "1 of 5 stars"
 *   - Themes are presented as a list, not free-floating spans
 *
 * Per `.claude/rules/copy-voice.md`:
 *   - Numbers visible, no jargon
 *   - "Unanswered" not "Pending owner response"
 *   - Sign-off line is mono + small, doesn't compete with the body
 *
 * This scaffold renders the AI draft in read-only form. The interactive
 * "Post to Google" + "Edit draft" + "Regenerate" + EN/ES toggle land in
 * a follow-up task once the Google My Business API integration (G.5) is
 * in place. Today's CTA shows as `disabled` with a helper tooltip so
 * Maria knows the feature is coming.
 */

export interface ReviewCardLabels {
  /** "Unanswered" pill text. */
  statusUnanswered: string;
  /** "Replied" pill text when the owner already replied. */
  statusReplied: string;
  /** "Urgent · 1★" pill text — applied when `isUrgent`. */
  urgent: string;
  /** "Negative" sentiment pill (sentiment === 'NEGATIVE'). */
  sentimentNegative: string;
  /** "Positive" sentiment pill. */
  sentimentPositive: string;
  /** "Neutral" sentiment pill. */
  sentimentNeutral: string;
  /** Prior-reviewer line, e.g. "2 prior reviews" — pluralised by caller. */
  priorReviews: string;
  /** AI reply heading "AI-drafted reply". */
  aiDraftLabel: string;
  /** "Post to Google" CTA. */
  ctaPost: string;
  /** "Edit draft" secondary action. */
  ctaEdit: string;
  /** "Regenerate" tertiary action. */
  ctaRegenerate: string;
  /** Helper text shown next to disabled CTAs (e.g. "Coming soon"). */
  ctaComingSoon: string;
  /** Days-ago formatter ({days} replaced) — e.g. "6 days ago". */
  daysAgoLabel: string;
  /** No-text-fallback when the reviewer left only stars. */
  noText: string;
  /** "English" label for the AI-reply language toggle. */
  langEn: string;
  /** "Español" label for the AI-reply language toggle. */
  langEs: string;
}

export interface ReviewCardProps {
  review: ReviewItem;
  labels: ReviewCardLabels;
}

export function ReviewCard({ review, labels }: ReviewCardProps) {
  const accentBg = review.isUrgent
    ? "rgba(195, 85, 58, 0.06)"
    : "var(--color-bg-2)";
  const accentBorder = review.isUrgent
    ? "var(--color-coral)"
    : "var(--color-border)";

  return (
    <article
      aria-labelledby={`review-${review.id}-meta`}
      style={{
        background: accentBg,
        border: `1px solid ${accentBorder}`,
        borderLeftWidth: review.isUrgent ? 3 : 1,
        borderRadius: 14,
        padding: "18px 20px",
        marginBottom: 14,
        boxShadow: "0 2px 8px rgba(28, 25, 22, 0.04)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
          marginBottom: 12,
        }}
      >
        <Avatar initials={review.reviewerInitials} urgent={review.isUrgent} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            id={`review-${review.id}-meta`}
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
              marginBottom: 4,
            }}
          >
            <strong
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 14,
                color: "var(--color-text)",
              }}
            >
              {review.reviewerInitials}
            </strong>
            <StarRating value={review.stars} />
            <time
              dateTime={review.postedAt}
              style={{
                fontSize: 12,
                color: "var(--color-text-3)",
              }}
            >
              {labels.daysAgoLabel.replace("{days}", String(review.daysAgo))}
            </time>
            {review.isUrgent ? (
              <Pill tone="bad" size="sm" dot>
                {labels.urgent}
              </Pill>
            ) : null}
            {review.sentiment ? (
              <Pill
                tone={sentimentTone(review.sentiment)}
                size="sm"
                dot
                title={undefined}
              >
                {sentimentLabel(review.sentiment, labels)}
              </Pill>
            ) : null}
          </div>

          {review.reviewerPriorReviews != null ? (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-text-3)",
                marginTop: 2,
              }}
            >
              {labels.priorReviews.replace(
                "{count}",
                String(review.reviewerPriorReviews),
              )}
            </div>
          ) : null}
        </div>

        <StatusBadge
          replied={review.ownerReplied}
          daysAgo={review.daysAgo}
          labels={labels}
        />
      </header>

      <p
        style={{
          fontSize: 14,
          lineHeight: 1.55,
          color: "var(--color-text-2)",
          margin: "0 0 12px",
          // Long Google reviews are common — display them in full per
          // the design ref. CSS line-clamping is unsafe here because we
          // want screen readers to receive the entire review text.
        }}
      >
        {review.text ? `"${review.text}"` : labels.noText}
      </p>

      {review.themes.length > 0 ? (
        <ul
          aria-label="themes"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            listStyle: "none",
            padding: 0,
            margin: "0 0 12px",
          }}
        >
          {review.themes.map((t) => (
            <li key={t}>
              <span
                style={{
                  display: "inline-block",
                  padding: "3px 8px",
                  borderRadius: 8,
                  background: "var(--color-bg-3)",
                  color: "var(--color-text-2)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                }}
              >
                theme: {t}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {review.ownerReplied && review.ownerReplyText ? (
        <OwnerReply
          text={review.ownerReplyText}
          when={review.ownerReplyAt}
          labels={labels}
        />
      ) : review.aiReplyDraftEn || review.aiReplyDraftEs ? (
        <AIReplyDraft review={review} labels={labels} />
      ) : null}
    </article>
  );
}

function Avatar({ initials, urgent }: { initials: string; urgent: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 36,
        height: 36,
        borderRadius: "50%",
        background: urgent
          ? "var(--color-coral)"
          : "var(--color-bg-3, #f2ebe3)",
        color: urgent ? "#fff" : "var(--color-text-2)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initials.replace(/\./g, "")}
    </span>
  );
}

function StatusBadge({
  replied,
  daysAgo,
  labels,
}: {
  replied: boolean;
  daysAgo: number;
  labels: ReviewCardLabels;
}) {
  if (replied) {
    return (
      <Pill tone="good" size="sm">
        {labels.statusReplied}
      </Pill>
    );
  }
  return (
    <Pill tone="warn" size="sm" title={undefined}>
      {labels.statusUnanswered} · {daysAgo}d
    </Pill>
  );
}

function OwnerReply({
  text,
  when,
  labels: _labels,
}: {
  text: string;
  when: string | null;
  labels: ReviewCardLabels;
}) {
  return (
    <div
      style={{
        marginTop: 8,
        padding: "12px 14px",
        background: "rgba(45, 134, 89, 0.06)",
        border: "1px solid rgba(45, 134, 89, 0.18)",
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--color-success, #2d8659)",
          marginBottom: 6,
        }}
      >
        Owner replied
        {when ? ` · ${new Date(when).toISOString().slice(0, 10)}` : null}
      </div>
      <div
        style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-text)" }}
      >
        {text}
      </div>
    </div>
  );
}

function AIReplyDraft({
  review,
  labels,
}: {
  review: ReviewItem;
  labels: ReviewCardLabels;
}) {
  // Render the body via a small client island so Maria can toggle
  // EN ↔ ES. The framing (label + buttons) stays on the server so
  // only the toggle + draft text + meta line cross the hydration
  // boundary.
  if (!review.aiReplyDraftEn && !review.aiReplyDraftEs) return null;

  return (
    <div
      style={{
        marginTop: 12,
        padding: "14px 16px",
        background: "var(--color-bg-3, #f2ebe3)",
        border: "1px dashed var(--color-border-strong, #d8c9b8)",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--color-coral)",
            fontWeight: 600,
          }}
        >
          <span aria-hidden>✦</span>
          {labels.aiDraftLabel}
        </span>
      </div>

      <AIReplyDraftBody
        draftEn={review.aiReplyDraftEn}
        draftEs={review.aiReplyDraftEs}
        labelEn={labels.langEn}
        labelEs={labels.langEs}
        buildMeta={(text) => {
          const words = text.split(/\s+/).filter(Boolean).length;
          return `${words} words · ${text.length} chars`;
        }}
      />

      <div style={{ marginTop: 12 }}></div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          disabled
          aria-disabled="true"
          title={labels.ctaComingSoon}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            background: "var(--color-coral)",
            color: "#fff",
            border: "none",
            borderRadius: 999,
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "not-allowed",
            opacity: 0.7,
          }}
        >
          {labels.ctaPost}
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title={labels.ctaComingSoon}
          style={ghostButton}
        >
          {labels.ctaEdit}
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title={labels.ctaComingSoon}
          style={ghostButton}
        >
          {labels.ctaRegenerate}
        </button>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--color-text-3)",
            marginLeft: "auto",
          }}
        >
          {labels.ctaComingSoon}
        </span>
      </div>
    </div>
  );
}

const ghostButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  background: "transparent",
  color: "var(--color-text-2)",
  border: "1px solid var(--color-border)",
  borderRadius: 999,
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "not-allowed",
  opacity: 0.6,
};

function sentimentTone(
  s: "POSITIVE" | "NEUTRAL" | "NEGATIVE",
): "good" | "neutral" | "bad" {
  switch (s) {
    case "POSITIVE":
      return "good";
    case "NEGATIVE":
      return "bad";
    default:
      return "neutral";
  }
}

function sentimentLabel(
  s: "POSITIVE" | "NEUTRAL" | "NEGATIVE",
  labels: ReviewCardLabels,
): string {
  switch (s) {
    case "POSITIVE":
      return labels.sentimentPositive;
    case "NEGATIVE":
      return labels.sentimentNegative;
    default:
      return labels.sentimentNeutral;
  }
}
