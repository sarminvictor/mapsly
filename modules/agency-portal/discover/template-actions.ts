"use server";

/**
 * Saved goal templates · server actions (WP5-12).
 *
 * "Save as template" persists the working goal's ACTIVE signal set to the
 * per-agency `AgencyTemplate` table (WP0-9 storage); "My templates" in the
 * GoalStep gallery lists + deletes them. `signalsJson` stores the SAME
 * `DiscoverySignals` shape `Discovery.signalsJson` uses, so loading one
 * pre-seeds the goal exactly like a built-in template.
 *
 * Auth-gated + Zod-validated per `.claude/rules/security.md`; agency-scoped on
 * every read/write. Pure Prisma — no external API in the request path.
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma, { Prisma } from "@/lib/prisma";
import {
  ACTION_MUTATE_LIMIT,
  rateLimitAction,
} from "@/lib/middleware/rate-limit";
import { SIG_META } from "./goal-templates";

/** Keep an agency's library bounded (dense gallery, not a dumping ground). */
const MAX_TEMPLATES_PER_AGENCY = 10;

// Mirrors SignalTuneValue (flow-types.ts) — validated, never trusted.
const TuneSchema = z.union([
  z.object({
    kind: z.literal("strictness"),
    level: z.enum(["loose", "balanced", "strict"]),
  }),
  z.object({
    kind: z.literal("scale"),
    bands: z.array(z.string().max(60)).max(12),
  }),
  z.object({ kind: z.literal("mode"), value: z.string().max(60) }),
  z.object({
    kind: z.literal("platform"),
    values: z.array(z.string().max(60)).max(24),
  }),
  z.object({ kind: z.literal("presence"), value: z.enum(["has", "hasnt"]) }),
]);

const PersistedSignalSchema = z.object({
  key: z.string().min(1).max(80),
  tune: TuneSchema.optional(),
  conds: z.record(z.string().max(4), z.boolean()).optional(),
  match: z.enum(["all", "any"]).optional(),
});

const SaveInput = z.object({
  name: z.string().trim().min(1).max(80),
  /** GOAL_TEMPLATES key the goal was cloned from (null = from scratch). */
  basedOnTemplate: z.string().max(40).nullish(),
  /** The goal's ACTIVE signal set (DiscoverySignals.signals shape). */
  signals: z.array(PersistedSignalSchema).min(1).max(60),
  /**
   * When set, UPDATE the existing (agency-owned) template in place instead of
   * creating a new row — so re-clicking "Save" on a loaded template edits it
   * rather than spawning a duplicate. Absent → create a fresh row.
   */
  templateId: z.string().min(1).max(64).optional(),
});

export type SaveGoalTemplateInput = z.input<typeof SaveInput>;

export type SaveGoalTemplateResult =
  | { status: "ok"; templateId: string }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited"; retryAfter: number }
  | { status: "invalid_input"; message: string }
  | { status: "limit_reached"; max: number }
  // The templateId to update wasn't found for this agency (deleted, or a
  // cross-agency id). The caller drops the stale id and retries as a create.
  | { status: "not_found" }
  | { status: "error" };

export async function saveGoalTemplateAction(
  input: unknown,
): Promise<SaveGoalTemplateResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  // WP8-2 · bound template-save floods.
  const rl = await rateLimitAction(ACTION_MUTATE_LIMIT, session.user.id);
  if (rl.limited) return { status: "rate_limited", retryAfter: rl.retryAfter };

  const parsed = SaveInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  // Only known SIG_META keys are persistable — an unknown key could never
  // hydrate back into a working goal (and would be dead weight in the row).
  const signals = parsed.data.signals.filter((s) => SIG_META[s.key] != null);
  if (signals.length === 0) {
    return { status: "invalid_input", message: "no known signals to save" };
  }

  try {
    const member = await prisma.agencyMember.findFirst({
      where: { userId: session.user.id },
      select: { agencyId: true },
    });
    if (!member) return { status: "forbidden" };

    // Self-describing DiscoverySignals payload (goalName/goalBase ride along),
    // mirroring Discovery.signalsJson — shared by the create + update paths.
    const signalsJson = {
      signals,
      goalName: parsed.data.name,
      goalBase: parsed.data.basedOnTemplate ?? "custom",
    } as unknown as Prisma.InputJsonValue;

    // UPDATE path: an already-saved template is being re-saved. The where
    // carries agencyId (mirrors the delete action), so a foreign / deleted id
    // updates nothing → not_found. Updating does NOT grow the library, so the
    // cap check is skipped here — only creates count against MAX.
    if (parsed.data.templateId) {
      const res = await prisma.agencyTemplate.updateMany({
        where: { id: parsed.data.templateId, agencyId: member.agencyId },
        data: {
          name: parsed.data.name,
          basedOnTemplate: parsed.data.basedOnTemplate ?? null,
          signalsJson,
        },
      });
      if (res.count === 0) return { status: "not_found" };
      return { status: "ok", templateId: parsed.data.templateId };
    }

    const count = await prisma.agencyTemplate.count({
      where: { agencyId: member.agencyId },
    });
    if (count >= MAX_TEMPLATES_PER_AGENCY) {
      return { status: "limit_reached", max: MAX_TEMPLATES_PER_AGENCY };
    }

    const row = await prisma.agencyTemplate.create({
      data: {
        agencyId: member.agencyId,
        name: parsed.data.name,
        basedOnTemplate: parsed.data.basedOnTemplate ?? null,
        signalsJson,
      },
      select: { id: true },
    });

    return { status: "ok", templateId: row.id };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "goal-template.save.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}

const DeleteInput = z.object({ templateId: z.string().min(1).max(64) });

export type DeleteGoalTemplateResult =
  | { status: "ok" }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

export async function deleteGoalTemplateAction(
  input: unknown,
): Promise<DeleteGoalTemplateResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = DeleteInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const member = await prisma.agencyMember.findFirst({
      where: { userId: session.user.id },
      select: { agencyId: true },
    });
    if (!member) return { status: "forbidden" };

    // Agency-scoped delete: the where carries agencyId, so a foreign template
    // id deletes nothing (count 0 → not_found — never confirm it exists).
    const res = await prisma.agencyTemplate.deleteMany({
      where: { id: parsed.data.templateId, agencyId: member.agencyId },
    });
    if (res.count === 0) return { status: "not_found" };

    return { status: "ok" };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "goal-template.delete.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
