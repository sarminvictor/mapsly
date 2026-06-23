// modules/contacts/legacy-contacts.ts · pure mapping of a Business's legacy
// single-value contact fields (email/phone/instagramHandle/contactInfo JSON)
// into normalized Contact rows. Used by scripts/migrate-contacts.ts to backfill
// the new multi-contact table. Pure + testable; the script does the DB writes.

import { normalizeEmail, normalizePhone } from "./reachability";

export interface LegacyContactRow {
  channel: string; // ContactChannel value
  value: string;
  normalizedValue: string;
  source: string; // ContactSource value
}

interface LegacyBusiness {
  email?: string | null;
  phone?: string | null;
  instagramHandle?: string | null;
  contactInfo?: unknown; // Json: array of { type, value }
}

const CONTACT_INFO_CHANNEL: Record<string, string> = {
  email: "EMAIL",
  phone: "PHONE",
  whatsapp: "WHATSAPP",
  facebook: "FACEBOOK",
  instagram: "INSTAGRAM",
  linkedin: "LINKEDIN",
  tiktok: "TIKTOK",
  youtube: "YOUTUBE",
  twitter: "X",
  x: "X",
  yelp: "YELP",
};

/** Map one business's legacy contact fields → de-duped Contact rows. */
export function legacyContactRows(b: LegacyBusiness): LegacyContactRow[] {
  const out: LegacyContactRow[] = [];
  const push = (
    channel: string,
    value: string,
    normalizedValue: string | null,
    source: string,
  ) => {
    if (value && normalizedValue)
      out.push({ channel, value, normalizedValue, source });
  };

  if (b.email) push("EMAIL", b.email, normalizeEmail(b.email), "MANUAL");
  if (b.phone) push("PHONE", b.phone, normalizePhone(b.phone), "DFS_LISTING");
  if (b.instagramHandle) {
    const handle = b.instagramHandle.replace(/^@/, "").trim();
    if (handle)
      push(
        "INSTAGRAM",
        b.instagramHandle,
        `instagram.com/${handle.toLowerCase()}`,
        "DFS_LISTING",
      );
  }

  if (Array.isArray(b.contactInfo)) {
    for (const raw of b.contactInfo) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as { type?: unknown; value?: unknown };
      const type = String(item.type ?? "")
        .toLowerCase()
        .trim();
      const value = typeof item.value === "string" ? item.value : "";
      const channel = CONTACT_INFO_CHANNEL[type];
      if (!channel || !value) continue;
      const normalized =
        channel === "EMAIL"
          ? normalizeEmail(value)
          : channel === "PHONE" || channel === "WHATSAPP"
            ? normalizePhone(value)
            : value.toLowerCase().trim();
      push(channel, value, normalized, "DFS_MAPS");
    }
  }

  // De-dupe by (channel, normalizedValue) keeping the first (highest-trust) hit.
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.channel}|${r.normalizedValue}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
