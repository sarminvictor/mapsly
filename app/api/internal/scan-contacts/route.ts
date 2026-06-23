/**
 * /api/internal/scan-contacts · the contacts + tech enrichment worker entry.
 *
 * POST a batch of businessIds; runs `scanBusinessContacts` for each inside a
 * single `withCronRun("enrich:contacts")` frame. This is the ONLY place the
 * polite homepage fetch happens — keeping all external fetches out of the user
 * request path (per .claude/rules/cost-discipline.md "no live API in user
 * path"). One fetch per business enriches BOTH contacts and tech at $0.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}. Mirrors the inline guard used by
 * the other cron/internal worker routes.
 *
 * Idempotency: `scanBusinessContacts` upserts Contact + BusinessTech rows
 * keyed on stable identifiers — a retry re-scans and updates in place, never
 * duplicates. One failed business never fails the batch; its summary records
 * status="error" and the run still closes OK.
 *
 * See:
 *   - modules/contacts/scan.ts — the per-business scan
 *   - app/api/internal/trigger-website-scan/route.ts — sibling worker pattern
 */

import { z } from "zod";

import { withCronRun } from "@/lib/cost/cost-counter";
import { scanBusinessContacts } from "@/modules/contacts/scan";
import type { ContactScanSummary } from "@/modules/contacts/scan";

// A batch of homepage fetches (8s timeout each) processed sequentially. Cap the
// batch upstream; 120s is generous headroom under Vercel's default + the
// worker's per-job cap.
export const maxDuration = 120;

const PayloadSchema = z.object({
  businessIds: z.array(z.string().min(1).max(128)).min(1).max(100),
});

/** Per-business outcome line in the batch response. */
type BatchItem =
  | (ContactScanSummary & { ok: true })
  | { ok: false; businessId: string; error: string };

export async function POST(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (
    !process.env.CRON_SECRET ||
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let businessIds: string[];
  try {
    const json = (await request.json()) as unknown;
    const result = PayloadSchema.safeParse(json);
    if (!result.success) {
      return Response.json(
        { error: "invalid_input", details: result.error.flatten() },
        { status: 400 },
      );
    }
    businessIds = result.data.businessIds;
  } catch {
    return Response.json({ error: "malformed_json" }, { status: 400 });
  }

  try {
    const items = await withCronRun("enrich:contacts", async () => {
      const out: BatchItem[] = [];
      for (const businessId of businessIds) {
        try {
          const summary = await scanBusinessContacts(businessId);
          out.push({ ok: true, ...summary });
        } catch (err) {
          // One business failing must not abort the batch — record + continue.
          out.push({
            ok: false,
            businessId,
            error: err instanceof Error ? err.message : "unknown",
          });
        }
      }
      return out;
    });

    const succeeded = items.filter((i) => i.ok).length;
    return Response.json(
      { ok: true, processed: items.length, succeeded, items },
      { status: 200 },
    );
  } catch (err) {
    console.error(
      "[/api/internal/scan-contacts] threw:",
      err instanceof Error ? err.stack : err,
    );
    return Response.json(
      {
        error: "internal_error",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}
