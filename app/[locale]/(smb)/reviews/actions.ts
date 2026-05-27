"use server";

/**
 * SMB reviews · server actions.
 *
 * regenerateReplyAction · generates (or re-generates) the AI reply draft
 * for one review. Matches the owner's voice by sampling up to 8 of their
 * recent owner-replied reviews on the SAME business — passes them as
 * paired (review → owner reply) few-shot examples to draftReplyUncached
 * so the model learns the owner's exact openers, closings, emoji use,
 * and signature phrases. Bypasses the 6h cache (always fresh).
 *
 * Auth: requires the caller to own the Business (Business.ownerUserId)
 * OR be an ADMIN.
 *
 * Cost: ~$0.003–0.005 per call on gpt-5.4-mini · few-shot examples bump
 * input tokens but per-call stays under $0.01. Bills to the open
 * `manual:smb-regenerate-reply` CronRun · visible at /admin/cron-runs.
 */

import { z } from "zod";
import { revalidateTag } from "next/cache";

import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { withCronRun } from "@/lib/cost/cost-counter";
import {
  draftReplyUncached,
  type ReplyTone,
  type VoiceExample,
} from "@/services/ai/reply-draft";

export type ActionResult<T = null> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string };

const RegenerateSchema = z.object({
  reviewId: z.string().min(1).max(128),
  tone: z.enum(["warm", "professional", "apologetic"]).default("warm"),
});

export interface RegenerateReplyResult {
  draftEn: string;
  draftEs: string;
  /** How many of the owner's prior replies were sampled for voice
   *  context. 0 → first reply Maria's writing (warm default tone). */
  voiceNotesSampleCount: number;
}

export async function regenerateReplyAction(
  _prev: ActionResult<RegenerateReplyResult> | null,
  formData: FormData,
): Promise<ActionResult<RegenerateReplyResult>> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { ok: false, error: "unauthorized" };

    const parsed = RegenerateSchema.safeParse({
      reviewId: formData.get("reviewId"),
      tone: formData.get("tone") || "warm",
    });
    if (!parsed.success) {
      return { ok: false, error: "invalid_input" };
    }
    const { reviewId, tone } = parsed.data;

    // Fetch review + business + auth gate in one shot.
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      select: {
        id: true,
        stars: true,
        text: true,
        reviewerName: true,
        businessId: true,
        business: {
          select: {
            id: true,
            slug: true,
            name: true,
            category: true,
            ownerUserId: true,
          },
        },
      },
    });
    if (!review) return { ok: false, error: "review_not_found" };
    if (!review.text || review.text.trim().length === 0) {
      return { ok: false, error: "review_has_no_text" };
    }

    const isOwner = review.business.ownerUserId === session.user.id;
    const isAdmin = session.user.role === "ADMIN";
    if (!isOwner && !isAdmin) {
      return { ok: false, error: "forbidden" };
    }

    // Sample owner-replied reviews for voice context · up to 8 most
    // recent on the SAME business. We fetch BOTH the review text and
    // the owner reply so the model sees the (trigger → response)
    // pairing · this is materially better tone learning than flat
    // reply-only voice notes (Boxly-style few-shot pattern).
    const samples = await prisma.review.findMany({
      where: {
        businessId: review.business.id,
        ownerReplied: true,
        ownerReplyText: { not: null },
        id: { not: reviewId },
      },
      orderBy: { ownerReplyAt: "desc" },
      take: 8,
      select: {
        stars: true,
        text: true,
        ownerReplyText: true,
      },
    });

    const voiceExamples: VoiceExample[] = samples
      .filter((s) => s.ownerReplyText && s.ownerReplyText.trim().length > 0)
      .map((s) => ({
        reviewStars: s.stars,
        reviewText: s.text,
        ownerReply: s.ownerReplyText!,
      }));

    const drafts = await withCronRun(
      "manual:smb-regenerate-reply",
      async () => {
        return draftReplyUncached({
          stars: review.stars,
          text: review.text!,
          businessName: review.business.name,
          category: review.business.category,
          // reviewerName is the anonymized initial (e.g. "S.B."). The
          // prompt instructs the model to treat initials as "Hi there"
          // rather than greet by the literal initial. Per
          // `.claude/rules/security.md` § PII, we never store the full
          // reviewer name. Maria can edit the placeholder when she
          // posts to Google (where she sees the real name anyway).
          reviewerName: review.reviewerName,
          tone: tone as ReplyTone,
          voiceExamples: voiceExamples.length > 0 ? voiceExamples : undefined,
        });
      },
    );

    // Persist + revalidate.
    await prisma.review.update({
      where: { id: reviewId },
      data: {
        aiReplyDraftEn: drafts.en,
        aiReplyDraftEs: drafts.es,
      },
    });
    revalidateTag(`business-${review.business.slug}-reviews`, "hours");

    return {
      ok: true,
      data: {
        draftEn: drafts.en,
        draftEs: drafts.es,
        voiceNotesSampleCount: voiceExamples.length,
      },
      message:
        voiceExamples.length > 0
          ? `Reply generated · matched tone from ${voiceExamples.length} prior reply(ies).`
          : "Reply generated · default warm tone (no prior replies to match).",
    };
  } catch (err) {
    console.warn(
      "[regenerateReplyAction] failed:",
      err instanceof Error ? err.message : err,
    );
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}
