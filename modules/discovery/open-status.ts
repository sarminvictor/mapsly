// modules/discovery/open-status.ts · extract operating status from a DfS Maps
// row (Phase 2). DataForSEO surfaces this in
// `work_time.work_hours.current_status`; we previously swallowed it into the
// hours JSON and never queried it, so permanently-closed businesses polluted
// lists. This maps it to a queryable enum value.

export type OpenStatus =
  | "OPEN"
  | "CLOSED"
  | "TEMPORARILY_CLOSED"
  | "CLOSED_FOREVER"
  | "UNKNOWN";

/**
 * Map DfS `current_status` to our enum. A shop that is merely closed right now
 * (outside business hours) is still OPERATING → OPEN, not CLOSED_FOREVER.
 */
export function mapOpenStatus(
  currentStatus: string | null | undefined,
): OpenStatus {
  switch ((currentStatus ?? "").toLowerCase().trim()) {
    case "closed_forever":
    case "permanently_closed":
      return "CLOSED_FOREVER";
    case "temporarily_closed":
      return "TEMPORARILY_CLOSED";
    case "open":
    case "open_24":
    case "close": // closed at this moment, but operating
    case "closed": // (DfS spelling variants) operating, just closed now
      return "OPEN";
    default:
      return "UNKNOWN";
  }
}

type MapsRowLike = {
  work_time?: { work_hours?: { current_status?: string | null } | null } | null;
};

/** Pull the operating status out of a raw DfS business_listings row. */
export function extractOpenStatus(
  row: MapsRowLike | null | undefined,
): OpenStatus {
  return mapOpenStatus(row?.work_time?.work_hours?.current_status ?? null);
}

/**
 * Whether a business should be excluded from the default Raw List view.
 * Permanently-closed businesses are excluded by default (still visible via a
 * "show closed" filter); temporarily-closed are badged but kept (still a lead).
 */
export function isExcludedFromRawList(b: { openStatus: OpenStatus }): boolean {
  return b.openStatus === "CLOSED_FOREVER";
}
