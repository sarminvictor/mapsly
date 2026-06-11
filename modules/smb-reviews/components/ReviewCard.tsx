"use client";

import * as React from "react";
import { useState } from "react";

import { Pill } from "@/components/ui";
import { AIReplyDraftBody } from "./AIReplyDraftBody";
import { HighlightedReviewText } from "./HighlightedReviewText";
import { ReplyActions } from "./ReplyActions";
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
  /** "Generate reply" CTA · shown when no draft exists yet. */
  ctaGenerate: string;
  /** "Post to Google" CTA. */
  ctaPost: string;
  /** "Skip" CTA — moves the review to the Skipped tab. */
  ctaSkip: string;
  /** "Restore" CTA — shown in the Skipped tab to return a review. */
  ctaUnskip: string;
  /** "Save" CTA for the edited draft. */
  ctaSave: string;
  /** Confirmation shown after a draft save, e.g. "Saved". */
  ctaSaved: string;
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
  /**
   * "HIPAA-aware" badge on the AI-draft panel. Set ONLY for
   * human-medical businesses (the page gates on `isHumanMedicalCategory`
   * — same matcher that flips the PHI guardrail in the draft prompt).
   * Undefined → no badge.
   */
  hipaaBadge?: string;
  /** Plain-English hover tooltip for the badge ("Drafts never confirm
   *  someone was a patient or mention treatments."). */
  hipaaTooltip?: string;
  /**
   * S2/S3 · privacy-check labels. Set ONLY for human-medical businesses
   * (same gate as `hipaaBadge`). Undefined → no hint line on published
   * replies, no pre-publish confirm, zero behavior change.
   */
  /** Per-review hint on a flagged published reply, high level ("May
   *  confirm a patient relationship — consider an edit"). */
  privacyHintHigh?: string;
  /** Per-review hint, caution level (date / payment reference). */
  privacyHintCaution?: string;
  /** Generate-CTA label on the flagged-reply fix path ("Draft a safer
   *  reply"). Falls back to `ctaGenerate` when unset. */
  privacyFixCta?: string;
  /** S3 · inline confirm headline shown at post-click when the draft
   *  still flags. Presence of this label enables the check. */
  privacyConfirmTitle?: string;
  /** S3 · default confirm action ("Edit reply"). */
  privacyConfirmEdit?: string;
  /** S3 · escape hatch ("Post anyway"). */
  privacyConfirmPost?: string;
}

export interface ReviewCardProps {
  review: ReviewItem;
  labels: ReviewCardLabels;
  /** Business Google reviews URL (from googlePlaceId) · null → no Post button. */
  googleReviewsUrl: string | null;
  /** True in the Skipped tab · the queue button restores instead of skips. */
  isSkippedTab: boolean;
  /** Optimistic skip/restore handler owned by the parent list. */
  onMove: (reviewId: string) => void;
}

export function ReviewCard({
  review,
  labels,
  googleReviewsUrl,
  isSkippedTab,
  onMove,
}: ReviewCardProps) {
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
              {formatRelativeAgo(review.daysAgo)}
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
          // Preserve line breaks (Google reviews and owner replies sometimes
          // contain hard \n) while collapsing redundant inline whitespace.
          // pre-line also makes long reviews wrap naturally at the column.
          whiteSpace: "pre-line",
          // Long Google reviews are common — display them in full per
          // the design ref. CSS line-clamping is unsafe here because we
          // want screen readers to receive the entire review text.
        }}
      >
        {review.text ? (
          <>
            &ldquo;
            <HighlightedReviewText
              text={review.text}
              people={review.mentionedPeople}
              services={review.mentionedServices}
            />
            &rdquo;
          </>
        ) : (
          labels.noText
        )}
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
        <>
          <OwnerReply
            text={review.ownerReplyText}
            when={review.ownerReplyAt}
            labels={labels}
            privacyRisk={review.privacyRisk}
          />
          {/* S2 fix path · a flagged published reply gets the same draft
              panel: "Draft a safer reply" runs the existing regenerate
              action; once a draft exists Maria edits it inline and posts
              the replacement to Google (with the S3 check). */}
          {review.privacyRisk &&
          review.text &&
          review.text.trim().length > 0 ? (
            <AIReplyDraft
              review={review}
              labels={labels}
              googleReviewsUrl={googleReviewsUrl}
              isSkippedTab={isSkippedTab}
              onMove={onMove}
              hideQueue
              generateLabelOverride={labels.privacyFixCta}
            />
          ) : null}
        </>
      ) : review.text && review.text.trim().length > 0 ? (
        // Always render the draft panel for reviews with text — even when
        // there is no AI draft yet · the Generate button lives there.
        <AIReplyDraft
          review={review}
          labels={labels}
          googleReviewsUrl={googleReviewsUrl}
          isSkippedTab={isSkippedTab}
          onMove={onMove}
        />
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
      {labels.statusUnanswered} · {formatRelativeAgoShort(daysAgo)}
    </Pill>
  );
}

/**
 * "138 days ago" → "4 months ago" · "730 days ago" → "2 years ago".
 * Used by the timestamp line above the review text.
 */
function formatRelativeAgo(daysAgo: number): string {
  if (daysAgo < 0) return "just now";
  if (daysAgo === 0) return "today";
  if (daysAgo === 1) return "yesterday";
  if (daysAgo < 30) return `${daysAgo} days ago`;
  if (daysAgo < 60) return "1 month ago";
  if (daysAgo < 365) return `${Math.round(daysAgo / 30)} months ago`;
  if (daysAgo < 730) return "1 year ago";
  return `${Math.round(daysAgo / 365)} years ago`;
}

/** Compact form for the "Unanswered · 4mo" status pill. */
function formatRelativeAgoShort(daysAgo: number): string {
  if (daysAgo < 1) return "today";
  if (daysAgo < 30) return `${daysAgo}d`;
  if (daysAgo < 365) return `${Math.round(daysAgo / 30)}mo`;
  return `${Math.round(daysAgo / 365)}y`;
}

function OwnerReply({
  text,
  when,
  labels,
  privacyRisk,
}: {
  text: string;
  when: string | null;
  labels: ReviewCardLabels;
  /** S2 · privacy flag computed server-side over this published reply.
   *  Null = clean (or non-medical business — labels absent then too). */
  privacyRisk: { level: "high" | "caution"; hint: string } | null;
}) {
  const privacyHintLabel = privacyRisk
    ? privacyRisk.level === "high"
      ? labels.privacyHintHigh
      : labels.privacyHintCaution
    : undefined;

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
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--color-text)",
          // Owner replies from Google often contain hard line breaks.
          // pre-line preserves them without trusting raw HTML.
          whiteSpace: "pre-line",
        }}
      >
        {text}
      </div>
      {privacyRisk && privacyHintLabel ? (
        // S2 · small coral hint. The tooltip quotes the exact phrase that
        // triggered the flag so Maria knows what to edit.
        <p
          title={privacyRisk.hint ? `“${privacyRisk.hint}”` : undefined}
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1.45,
            color: "var(--color-coral)",
            cursor: privacyRisk.hint ? "help" : undefined,
          }}
        >
          {privacyHintLabel}
        </p>
      ) : null}
    </div>
  );
}

function AIReplyDraft({
  review,
  labels,
  googleReviewsUrl,
  isSkippedTab,
  onMove,
  hideQueue,
  generateLabelOverride,
}: {
  review: ReviewItem;
  labels: ReviewCardLabels;
  googleReviewsUrl: string | null;
  isSkippedTab: boolean;
  onMove: (reviewId: string) => void;
  /** S2 fix path · hide Skip/Restore (already-replied reviews). */
  hideQueue?: boolean;
  /** S2 fix path · "Draft a safer reply" instead of "Generate reply". */
  generateLabelOverride?: string;
}) {
  // Renders two states:
  //   1. No draft yet · the Generate CTA (samples the owner's prior
  //      replies to match Maria's voice) + Skip/Restore.
  //   2. Has draft · editable text + Save (in AIReplyDraftBody) + Post
  //      to Google + Skip/Restore.
  const hasDraft = Boolean(review.aiReplyDraftEn);

  // S3 · track the CURRENT draft text for the pre-publish privacy check.
  // `editedText` stays null until Maria types, so a freshly regenerated
  // draft (new `review.aiReplyDraftEn` from revalidation) is what gets
  // checked — not a stale snapshot from mount time.
  const [editedText, setEditedText] = useState<string | null>(null);
  const currentText = editedText ?? review.aiReplyDraftEn ?? "";

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
        {labels.hipaaBadge ? (
          <Pill tone="good" size="sm" dot={false} title={labels.hipaaTooltip}>
            {labels.hipaaBadge}
          </Pill>
        ) : null}
      </div>

      {hasDraft ? (
        <>
          <AIReplyDraftBody
            reviewId={review.id}
            draftEn={review.aiReplyDraftEn}
            labels={{ save: labels.ctaSave, saved: labels.ctaSaved }}
            onTextChange={setEditedText}
          />
          <div style={{ marginTop: 12 }} />
        </>
      ) : null}

      <ReplyActions
        reviewId={review.id}
        hasDraft={hasDraft}
        googleReviewsUrl={googleReviewsUrl}
        isSkippedTab={isSkippedTab}
        onMove={onMove}
        currentText={currentText}
        serviceNames={review.mentionedServices}
        hideQueue={hideQueue}
        labels={{
          generate: generateLabelOverride ?? labels.ctaGenerate,
          post: labels.ctaPost,
          skip: labels.ctaSkip,
          unskip: labels.ctaUnskip,
          privacyConfirmTitle: labels.privacyConfirmTitle,
          privacyConfirmEdit: labels.privacyConfirmEdit,
          privacyConfirmPost: labels.privacyConfirmPost,
        }}
      />
    </div>
  );
}

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
