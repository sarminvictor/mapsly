/**
 * Reports module · Vercel Blob upload helper (F.7).
 *
 * The CSV generator (`csv-export.ts`) is pure. This module wraps the
 * `@vercel/blob` SDK so the server action can upload the generated
 * CSV and hand the caller a signed-ish URL + 30-day expiry. We keep
 * Blob touches in their own file so unit tests of `csv-export.ts` do
 * not pull in the SDK.
 *
 * Why a separate file (not `csv-export.ts`):
 *
 *   - Pure function vs. I/O · easier to test in isolation
 *   - `@vercel/blob` is a server-only module; the column-picker UI
 *     (client component, follow-up) can import csv-export.ts safely
 *     without dragging Blob runtime into the bundle.
 *
 * Per `.claude/rules/security.md`: blobs are uploaded under a path
 * that includes the agency id and the list id so an attacker who
 * guesses a URL cannot poll for other agencies' exports. The pathname
 * also embeds an opaque `randomSuffix` so two simultaneous exports
 * from the same list do not collide.
 *
 * Per F.7 spec ("Writes to Vercel Blob, signed URL, 30d expiry"): we
 * record the 30-day expiry timestamp in the returned shape so the UI
 * can render "Link expires May 25". Vercel Blob does not currently
 * auto-expire individual uploads; cron `report-cleanup` (follow-up)
 * will purge blobs older than 30 days by reading the prefix list.
 */

import { put } from "@vercel/blob";

import type { CsvUploadResult } from "./types";

/** 30 days in ms · F.7 spec. */
const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export interface UploadCsvOptions {
  agencyId: string;
  listId: string;
  csv: string;
  /**
   * Filename hint · used as the leaf of the Blob pathname. The actual
   * stored pathname is fully derived (agencyId · listId · timestamp ·
   * suffix) so callers cannot trample each other.
   */
  baseName?: string;
  /**
   * Override the current time. Tests pass a fixed clock here so the
   * generated pathname and expiry are deterministic.
   */
  nowMs?: () => number;
  /**
   * Override the random suffix. Tests pass a stable suffix so the
   * generated pathname is deterministic.
   */
  randomSuffix?: () => string;
}

/**
 * Upload the CSV string to Vercel Blob. Returns enough metadata for
 * the UI to render a "Download · 47 KB · expires Jun 20" link.
 *
 * Errors propagate · the server action handles them and surfaces a
 * user-visible "Couldn't generate CSV. Try again in a minute." per
 * `.claude/rules/copy-voice.md` agency-voice error guidance.
 */
export async function uploadCsvToBlob(
  opts: UploadCsvOptions,
): Promise<CsvUploadResult> {
  const nowMs = opts.nowMs ? opts.nowMs() : Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const date = nowIso.slice(0, 10); // YYYY-MM-DD
  const stamp = nowIso.replace(/[:.]/g, "-"); // safe for path
  const suffix = opts.randomSuffix
    ? opts.randomSuffix()
    : Math.random().toString(36).slice(2, 10);
  const base = opts.baseName ?? "leads";

  // pathname format: agency/<agencyId>/list-<listId>/<date>/<base>-<stamp>-<suffix>.csv
  const pathname =
    `agency/${opts.agencyId}/list-${opts.listId}/${date}/` +
    `${base}-${stamp}-${suffix}.csv`;

  const blob = await put(pathname, opts.csv, {
    access: "public",
    contentType: "text/csv; charset=utf-8",
    // `addRandomSuffix: false` so the pathname above is the final one
    // (otherwise Vercel appends its own suffix and the UI's expected
    // path drifts).
    addRandomSuffix: false,
  });

  return {
    url: blob.url,
    pathname,
    size: Buffer.byteLength(opts.csv, "utf8"),
    expiresAt: new Date(nowMs + EXPIRY_MS).toISOString(),
  };
}
