"use server";

/**
 * SMB reviews · server actions.
 *
 * regenerateReplyAction · generates (or re-generates) the AI reply draft
 * for one review. Matches the owner's voice by sampling up to 5 of their
 * recent owner replies on OTHER reviews and feeding them as voice-notes
 * to draftReplyUncached. Bypasses the 6h cache (always fresh).
 *
 * Auth: requires the caller to own the Business (Business.ownerUserId)
 * OR be an ADMIN.
 *
 * Cost: ~$0.003 per call on gpt-5.4-mini (the reply-draft model). Bills
 * to the open `manual:smb-regenerate-reply` CronRun · visible at
 * /admin/cron-runs.
 */

import { z } from "zod";
import { revalidateTag } from "next/cache";

import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { withCronRun } from "@/lib/cost/cost-counter";
import { draftReplyUncached, type ReplyTone } from "@/services/ai/reply-draft";

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

    // Sample owner replies for voice context · use the most recent 5
    // from OTHER reviews of the same business. Skip if no prior replies
    // exist (Maria's first reply — defaults to warm voice).
    const samples = await prisma.review.findMany({
      where: {
        businessId: review.business.id,
        ownerReplied: true,
        ownerReplyText: { not: null },
        id: { not: reviewId },
      },
      orderBy: { ownerReplyAt: "desc" },
      take: 5,
      select: { ownerReplyText: true },
    });

    const voiceNotes =
      samples.length > 0
        ? buildVoiceNotes(samples.map((s) => s.ownerReplyText ?? ""))
        : undefined;

    const drafts = await withCronRun(
      "manual:smb-regenerate-reply",
      async () => {
        return draftReplyUncached({
          stars: review.stars,
          text: review.text!,
          businessName: review.business.name,
          category: review.business.category,
          tone: tone as ReplyTone,
          voiceNotes,
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
        voiceNotesSampleCount: samples.length,
      },
      message:
        samples.length > 0
          ? `Reply generated · matched tone from ${samples.length} prior reply(ies).`
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

/**
 * Build a voice-notes string from sample owner replies. Truncates each
 * sample to 300 chars to keep the prompt cost-controlled · the model
 * only needs ~tone signal, not full content.
 */
function buildVoiceNotes(samples: string[]): string {
  const trimmed = samples
    .map((s) => s.trim().slice(0, 300))
    .filter((s) => s.length > 0)
    .slice(0, 5);
  if (trimmed.length === 0) return "";
  return [
    "Match the owner's voice from these recent replies (note: openers, sign-offs, tone, sentence length, level of formality, use of emoji or none):",
    ...trimmed.map((s, i) => `Example ${i + 1}: ${s}`),
  ].join("\n");
}
