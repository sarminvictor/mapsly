// services/contact-scraper/reachability.ts · pure reachability classifier.
//
// Turns a parsed contact mix into a single ReachabilityStatus + a count of
// DISTINCT reachable channels. PURE — no Prisma, no network. Mirrors the
// semantics of modules/contacts/reachability.ts (the canonical gate) but is
// scoped to the scraper's ParsedContact shape so the parser package stays
// self-contained.
//
// WEBSITE / BOOKING_URL are destinations, not inboxes — they never count toward
// reach (you can't "contact" a booking page; it's where you send the lead).
//
// Local enum mirror keeps the module import-free; keep in lockstep with
// prisma/schema.prisma (enum ReachabilityStatus).

import type { ContactChannel } from "./parse";

/** Mirror of Prisma `ReachabilityStatus`. */
export type ReachabilityStatus =
  | "UNREACHABLE"
  | "EMAIL_ONLY"
  | "PHONE_ONLY"
  | "MULTI"
  | "RICH"
  | "UNKNOWN";

/** Channels that count as a reachable touchpoint (email, phone, WA, socials). */
const REACHABLE_CHANNELS: ReadonlySet<ContactChannel> = new Set<ContactChannel>(
  [
    "EMAIL",
    "PHONE",
    "WHATSAPP",
    "FACEBOOK",
    "INSTAGRAM",
    "LINKEDIN",
    "TIKTOK",
    "YOUTUBE",
    "X",
    "YELP",
  ],
);

export interface ReachabilityResult {
  readonly status: ReachabilityStatus;
  /** Count of DISTINCT reachable channels. */
  readonly reachableChannelCount: number;
}

/**
 * Classify reachability from a parsed contact mix.
 *
 * Rules (priority order):
 *   - 0 reachable channels                          → UNREACHABLE
 *   - ≥3 distinct channels AND has email AND phone  → RICH
 *   - ≥2 distinct channels                          → MULTI
 *   - exactly 1, email only                         → EMAIL_ONLY
 *   - exactly 1, phone-like only (PHONE/WHATSAPP)   → PHONE_ONLY
 *   - exactly 1, a single social                    → MULTI (a usable touchpoint)
 *
 * Counts DISTINCT channels (two Instagram links collapse to one INSTAGRAM via
 * the parser's de-dupe; here we de-dupe by channel kind for the threshold).
 */
export function computeReachability(
  contacts: ReadonlyArray<{ readonly channel: ContactChannel }>,
): ReachabilityResult {
  const reachable = new Set<ContactChannel>();
  for (const c of contacts) {
    if (REACHABLE_CHANNELS.has(c.channel)) reachable.add(c.channel);
  }
  const reachableChannelCount = reachable.size;

  if (reachableChannelCount === 0) {
    return { status: "UNREACHABLE", reachableChannelCount };
  }

  const hasEmail = reachable.has("EMAIL");
  const hasPhoneLike = reachable.has("PHONE") || reachable.has("WHATSAPP");

  // RICH = a deep, multi-modal presence: email + a way to call + a 3rd channel.
  if (reachableChannelCount >= 3 && hasEmail && hasPhoneLike) {
    return { status: "RICH", reachableChannelCount };
  }

  // MULTI = two or more distinct reachable channels.
  if (reachableChannelCount >= 2) {
    return { status: "MULTI", reachableChannelCount };
  }

  // Single-channel cases.
  if (hasEmail) return { status: "EMAIL_ONLY", reachableChannelCount };
  if (hasPhoneLike) return { status: "PHONE_ONLY", reachableChannelCount };

  // A single social channel is still a usable touchpoint.
  return { status: "MULTI", reachableChannelCount };
}
