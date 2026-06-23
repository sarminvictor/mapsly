/**
 * Reachability gate · Phase 4 (Contacts + reachability gate)
 *
 * PURE gate logic — no network, no Prisma. Turns a business's mix of contact
 * channels into a single reachability verdict and decides whether the business
 * may enter the enrichment / outreach pipeline at all.
 *
 * The load-bearing distinction (and the reason this is its own tested module):
 *
 *   A FAILED scan is NOT the same as UNREACHABLE.
 *
 * If we couldn't fetch the homepage (timeout, 5xx, blocked), we know NOTHING
 * about reachability — gating on that would quietly delete reachable businesses
 * from every list. Only a SUCCESSFUL scan that found zero reachable channels
 * (`contactScanStatus === "OK" && reachableChannelCount === 0`) is a true
 * "unreachable" — plus the explicit operator/owner hide (`isHidden`).
 *
 * Local string-literal unions mirror the Prisma enums (ContactChannel,
 * ReachabilityStatus, ContactScanStatus) so the module stays import-free and
 * pure. Keep them in lockstep with prisma/schema.prisma.
 *
 * See:
 *   - modules/contacts/extract.ts — produces the channel mix consumed here
 *   - .claude/rules/conventions.md — discriminated unions, strict TS
 *   - .claude/rules/testing.md §"Auth gates"-style invariant coverage
 */

// ─── Local enum mirrors (keep in sync with prisma/schema.prisma) ──────────────

/** Mirror of Prisma `ContactChannel`. */
export type ContactChannel =
  | "EMAIL"
  | "PHONE"
  | "WHATSAPP"
  | "FACEBOOK"
  | "INSTAGRAM"
  | "LINKEDIN"
  | "TIKTOK"
  | "YOUTUBE"
  | "X"
  | "YELP"
  | "BOOKING_URL"
  | "WEBSITE";

/** Mirror of Prisma `ReachabilityStatus`. */
export type ReachabilityStatus =
  | "UNREACHABLE"
  | "EMAIL_ONLY"
  | "PHONE_ONLY"
  | "MULTI"
  | "RICH"
  | "UNKNOWN";

/** Mirror of Prisma `ContactScanStatus`. */
export type ContactScanStatus = "PENDING" | "OK" | "FAILED" | "PARTIAL";

// ─── Channel classification ───────────────────────────────────────────────────

/**
 * Social channels — any one of these counts as a reachable touchpoint (you can
 * DM a business on Instagram). WEBSITE / BOOKING_URL are NOT direct contact
 * points (they're destinations, not inboxes) and never count toward reach.
 */
const SOCIAL_CHANNELS: ReadonlySet<ContactChannel> = new Set<ContactChannel>([
  "FACEBOOK",
  "INSTAGRAM",
  "LINKEDIN",
  "TIKTOK",
  "YOUTUBE",
  "X",
  "YELP",
]);

/** True when a channel is a reachable touchpoint (email, phone, WA, or social). */
export function isReachableChannel(channel: ContactChannel): boolean {
  return (
    channel === "EMAIL" ||
    channel === "PHONE" ||
    channel === "WHATSAPP" ||
    SOCIAL_CHANNELS.has(channel)
  );
}

// ─── Normalizers ──────────────────────────────────────────────────────────────

/** Lower-case + trim an email for canonical comparison/storage. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Normalize a phone to E.164-ish for US/CA ("+1XXXXXXXXXX"). Returns null when
 * the digit run can't be a valid NANP number. Mirrors extract.normalizePhone
 * intentionally (the gate must reject the same garbage the extractor would).
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

/**
 * Canonicalize a URL for stable comparison/storage: lower-cased host with a
 * leading "www." stripped, scheme forced to https, query + fragment dropped,
 * trailing slash removed. Returns the input trimmed if it can't be parsed
 * (lenient — never throw on a malformed stored URL).
 */
export function canonicalizeUrl(raw: string): string {
  const input = (raw ?? "").trim();
  if (!input) return "";
  let candidate = input;
  if (candidate.startsWith("//")) candidate = "https:" + candidate;
  else if (!/^https?:\/\//i.test(candidate)) candidate = "https://" + candidate;
  try {
    const url = new URL(candidate);
    const host = url.host.toLowerCase().replace(/^www\./, "");
    let path = url.pathname.replace(/\/+$/, "");
    if (path === "") path = "";
    return "https://" + host + path.toLowerCase();
  } catch {
    return input;
  }
}

// ─── Reachability classification ──────────────────────────────────────────────

/** What {@link reachabilityFromContacts} returns. */
export interface ReachabilitySummary {
  readonly status: ReachabilityStatus;
  /** Count of DISTINCT reachable channels (email, phone, whatsapp, socials). */
  readonly reachableChannelCount: number;
}

/**
 * Classify a business's reachability from its contact channel mix.
 *
 * "Kinds" of reach (for the MULTI/RICH thresholds):
 *   - email   → EMAIL
 *   - phone   → PHONE or WHATSAPP (both are a "phone-like" reach)
 *   - social  → any of FACEBOOK/INSTAGRAM/LINKEDIN/TIKTOK/YOUTUBE/X/YELP
 *
 * Rules (in priority order):
 *   - 0 reachable channels                                  → UNREACHABLE
 *   - email + phone-like + ≥1 social                        → RICH
 *   - ≥2 distinct kinds (e.g. email+phone, phone+social)    → MULTI
 *   - only email                                            → EMAIL_ONLY
 *   - only phone-like (phone and/or whatsapp)               → PHONE_ONLY
 *   - only social(s), no email/phone                        → MULTI
 *
 * The `reachableChannelCount` is by DISTINCT channel — two Instagram links
 * still count once via the caller's de-dupe; here we de-dupe by channel value.
 */
export function reachabilityFromContacts(
  contacts: ReadonlyArray<{ readonly channel: ContactChannel }>,
): ReachabilitySummary {
  const reachable = new Set<ContactChannel>();
  for (const c of contacts) {
    if (isReachableChannel(c.channel)) reachable.add(c.channel);
  }
  const reachableChannelCount = reachable.size;

  if (reachableChannelCount === 0) {
    return { status: "UNREACHABLE", reachableChannelCount };
  }

  const hasEmail = reachable.has("EMAIL");
  const hasPhoneLike = reachable.has("PHONE") || reachable.has("WHATSAPP");
  const hasSocial = [...reachable].some((ch) => SOCIAL_CHANNELS.has(ch));

  // Count how many distinct "kinds" of reach are present.
  const kinds =
    (hasEmail ? 1 : 0) + (hasPhoneLike ? 1 : 0) + (hasSocial ? 1 : 0);

  // RICH = the full house: a way to email, a way to call, and a social presence.
  if (hasEmail && hasPhoneLike && hasSocial) {
    return { status: "RICH", reachableChannelCount };
  }

  // MULTI = two or more distinct kinds (email+phone, email+social, phone+social).
  if (kinds >= 2) {
    return { status: "MULTI", reachableChannelCount };
  }

  // Single-kind cases.
  if (hasEmail) return { status: "EMAIL_ONLY", reachableChannelCount };
  if (hasPhoneLike) return { status: "PHONE_ONLY", reachableChannelCount };

  // Only social(s) and nothing else — still a usable, multi-touch presence.
  return { status: "MULTI", reachableChannelCount };
}

// ─── The enrichability gate ───────────────────────────────────────────────────

/**
 * The subset of a Business row the gate reads. Kept structural (not a Prisma
 * type) so this module stays pure and the gate is trivially testable.
 */
export interface EnrichabilityInput {
  readonly contactScanStatus: ContactScanStatus;
  readonly reachableChannelCount: number;
  readonly isHidden: boolean;
}

/**
 * Non-throwing reachability gate. Returns false ONLY when:
 *   - the business is explicitly hidden, OR
 *   - a SUCCESSFUL scan (OK) found zero reachable channels.
 *
 * A FAILED / PENDING / PARTIAL scan is NEVER treated as unreachable — we don't
 * know, so we let the business through (FAILED ≠ UNREACHABLE).
 */
export function isEnrichable(b: EnrichabilityInput): boolean {
  if (b.isHidden) return false;
  if (b.contactScanStatus === "OK" && b.reachableChannelCount === 0) {
    return false;
  }
  return true;
}

/**
 * Throwing variant for the enrichment pipeline's preconditions. Throws
 * `Error("unreachable")` exactly when {@link isEnrichable} is false. Use at
 * the top of any enrichment/outreach action so an unreachable or hidden
 * business can never be processed.
 */
export function assertEnrichable(b: EnrichabilityInput): void {
  if (!isEnrichable(b)) {
    throw new Error("unreachable");
  }
}

// ─── Hidden computation ───────────────────────────────────────────────────────

/**
 * The subset of a Business row {@link computeHidden} reads. Structural by
 * design. All fields optional/nullable so a half-populated discovery row is
 * handled gracefully.
 */
export interface HiddenInput {
  readonly website?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly reachableChannelCount?: number | null;
  readonly contactScanStatus?: ContactScanStatus | null;
  /** Google "permanently closed" / "temporarily closed" business status. */
  readonly isPermanentlyClosed?: boolean | null;
}

/** What {@link computeHidden} returns. */
export interface HiddenResult {
  readonly isHidden: boolean;
  /** Human-readable reason, or null when not hidden. */
  readonly hiddenReason: string | null;
}

/**
 * Decide whether a business should be hidden from lists, mirroring the
 * reachability gate. Hidden when:
 *   - permanently closed, OR
 *   - a successful scan found zero reachable channels AND the business has no
 *     website, no phone, and no email on the base row.
 *
 * The `hiddenReason` is operator-readable ("no website · no phone · no email"
 * / "permanently closed") for the dev dashboard + audit log.
 */
export function computeHidden(b: HiddenInput): HiddenResult {
  if (b.isPermanentlyClosed) {
    return { isHidden: true, hiddenReason: "permanently closed" };
  }

  const hasWebsite = !!(b.website && b.website.trim());
  const hasPhone = !!(b.phone && b.phone.trim());
  const hasEmail = !!(b.email && b.email.trim());
  const scanOk = b.contactScanStatus === "OK";
  const noReach = (b.reachableChannelCount ?? 0) === 0;

  // Only hide for emptiness when a successful scan confirms zero reach AND no
  // base contact fields exist. A FAILED/PENDING scan never hides (mirrors the
  // enrichability gate — FAILED ≠ UNREACHABLE).
  if (scanOk && noReach && !hasWebsite && !hasPhone && !hasEmail) {
    const missing: string[] = [];
    missing.push("no website");
    missing.push("no phone");
    missing.push("no email");
    return { isHidden: true, hiddenReason: missing.join(" · ") };
  }

  return { isHidden: false, hiddenReason: null };
}
