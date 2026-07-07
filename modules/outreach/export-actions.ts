"use server";

/**
 * exportTouchesCsvAction (WP5-7) · the built-but-orphaned exportDraftsCsv
 * (modules/outreach/handoff.ts) wired to the Touchpoints tab bulk bar.
 *
 * Returns the CSV text (the client downloads it as a blob — same pattern as
 * the workbench Export CSV). The CAN-SPAM guard is intact: drafts whose
 * business lacks a physical mailing address are REFUSED into `skipped`, so
 * the exported file is always legally sendable. Columns are Instantly/
 * Smartlead-shaped with evidence merge fields from whyJson (see handoff.ts).
 *
 * Export is NOT a spend action — STAFF may export per docs/seat-model.md.
 * Agency scope per modules/outreach/draft-scope.ts (stamped rows must match;
 * legacy null rows verify through the discovered-cell walk).
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { callerAgencyMember } from "@/modules/agency-portal/roles";
import { activeSignalsFromJson } from "@/modules/agency-portal/discover/discovery-signals";

import { exportDraftsCsv } from "./handoff";
import { loadAgencyDrafts } from "./draft-scope";

const Input = z.object({
  draftIds: z.array(z.string().min(1).max(64)).min(1).max(500),
});

export type ExportTouchesCsvInput = z.input<typeof Input>;

export type ExportTouchesCsvResult =
  | {
      status: "ok";
      csv: string;
      exported: number;
      /** Drafts refused for a missing mailing address (CAN-SPAM). */
      skipped: number;
    }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

export async function exportTouchesCsvAction(
  input: unknown,
): Promise<ExportTouchesCsvResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = Input.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const member = await callerAgencyMember(session.user.id);
    if (!member) return { status: "forbidden" };

    const drafts = await loadAgencyDrafts(
      member.agencyId,
      parsed.data.draftIds,
    );
    if (drafts.length === 0) return { status: "forbidden" };

    const result = await exportDraftsCsv(drafts);
    return {
      status: "ok",
      csv: result.csv,
      exported: result.exported,
      skipped: result.skipped.length,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "touchpoints.export-csv.error",
        userId: session.user.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}

// ── touchGenPreflightAction (T3/B1+B2) ───────────────────────────────────────
//
// The generate-touches overlay's upfront context, fetched once on open:
//
//   - hasMailingAddress · a null Agency.mailingAddress silently yields ZERO
//     email drafts (the generator skips every email touch, CAN-SPAM/CASL).
//     Knowing it BEFORE generation lets the overlay show the banner + disable
//     the email Generate instead of a post-hoc "Drafted 0" apology.
//   - goalSignalKeys · the discovery's persisted goal signals
//     (Discovery.signalsJson), so the pain-theme picker can default to the
//     themes the goal actually hunts (B1) — plain string keys per
//     cache-components.md Pattern 4.
//
// Read-only (no spend) — any agency member may call it.

const PreflightInput = z.object({
  discoveryId: z.string().min(1).max(64).optional(),
});

export type TouchGenPreflightInput = z.input<typeof PreflightInput>;

export type TouchGenPreflightResult =
  | {
      status: "ok";
      hasMailingAddress: boolean;
      /** The discovery's goal-signal keys ([] without a discoveryId or goal). */
      goalSignalKeys: string[];
    }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

export async function touchGenPreflightAction(
  input: unknown,
): Promise<TouchGenPreflightResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = PreflightInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const member = await callerAgencyMember(session.user.id);
    if (!member) return { status: "forbidden" };

    const agency = await prisma.agency.findUnique({
      where: { id: member.agencyId },
      select: { mailingAddress: true },
    });

    let goalSignalKeys: string[] = [];
    if (parsed.data.discoveryId) {
      // Agency-scoped: a discoveryId that isn't this agency's yields nothing.
      const discovery = await prisma.discovery.findFirst({
        where: { id: parsed.data.discoveryId, agencyId: member.agencyId },
        select: { signalsJson: true },
      });
      goalSignalKeys = activeSignalsFromJson(discovery?.signalsJson).map(
        (s) => s.key,
      );
    }

    return {
      status: "ok",
      hasMailingAddress: Boolean(agency?.mailingAddress?.trim()),
      goalSignalKeys,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "touchpoints.preflight.error",
        userId: session.user.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
