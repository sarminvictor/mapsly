/**
 * Golden tests for the pure contact parser + reachability classifier.
 *
 * Pure — no network, no DB. Each case uses a small representative HTML snippet.
 * The load-bearing assertions: a website-vendor email
 * (`webreporting@gargle.com`) is FILTERED, phones normalize to +1 E.164,
 * socials + booking links map to the right channel/role, and reachability
 * classifies the channel mix.
 */

import { describe, expect, test } from "vitest";

import { parseContacts, computeReachability, isVendorEmail } from "../index";
import type { ContactChannel } from "../parse";

const SRC = "https://soleaspa.com/";

/** Find the first parsed contact for a channel. */
function pick(html: string, channel: ContactChannel) {
  return parseContacts({ html, sourceUrl: SRC }).find(
    (c) => c.channel === channel,
  );
}

function channels(html: string): ContactChannel[] {
  return parseContacts({ html, sourceUrl: SRC }).map((c) => c.channel);
}

describe("parseContacts · emails", () => {
  test("mailto is high-confidence (90) with SCRAPE_MAILTO", () => {
    const html = `<a href="mailto:hello@soleaspa.com">Email us</a>`;
    const email = pick(html, "EMAIL");
    expect(email?.normalizedValue).toBe("hello@soleaspa.com");
    expect(email?.confidence).toBe(90);
    expect(email?.source).toBe("SCRAPE_MAILTO");
    expect(email?.role).toBe("GENERIC"); // hello@ → generic inbox
  });

  test("body-text email is lower-confidence (60) with SCRAPE_HOMEPAGE", () => {
    const html = `<p>Reach Dr. Smith at drsmith@soleaspa.com today.</p>`;
    const email = pick(html, "EMAIL");
    expect(email?.normalizedValue).toBe("drsmith@soleaspa.com");
    expect(email?.confidence).toBe(60);
    expect(email?.source).toBe("SCRAPE_HOMEPAGE");
    expect(email?.role).toBe("UNKNOWN"); // personal-looking → unknown
  });

  test("normalizes email case to lowercase", () => {
    const html = `<a href="mailto:Hello@SoleaSpa.com">x</a>`;
    expect(pick(html, "EMAIL")?.normalizedValue).toBe("hello@soleaspa.com");
  });

  test("FILTERS a website-vendor email (webreporting@gargle.com)", () => {
    const html = `
      <a href="mailto:webreporting@gargle.com">vendor</a>
      <a href="mailto:info@soleaspa.com">real</a>`;
    const emails = parseContacts({ html, sourceUrl: SRC }).filter(
      (c) => c.channel === "EMAIL",
    );
    expect(emails).toHaveLength(1);
    expect(emails[0].normalizedValue).toBe("info@soleaspa.com");
  });

  test("FILTERS no-reply + asset-like + placeholder emails", () => {
    const html = `
      <a href="mailto:noreply@soleaspa.com">a</a>
      <span>logo@2x.png</span>
      <a href="mailto:test@example.com">b</a>
      <a href="mailto:support@wixpress.com">c</a>`;
    expect(
      parseContacts({ html, sourceUrl: SRC }).filter(
        (c) => c.channel === "EMAIL",
      ),
    ).toHaveLength(0);
  });

  test("info@/contact@/hello@ → GENERIC role", () => {
    for (const local of ["info", "contact", "hello"]) {
      const html = `<a href="mailto:${local}@soleaspa.com">x</a>`;
      expect(pick(html, "EMAIL")?.role).toBe("GENERIC");
    }
  });
});

describe("parseContacts · phones", () => {
  test("tel: href normalizes to +1 E.164 with conf 90", () => {
    const html = `<a href="tel:+1 (305) 555-0142">Call</a>`;
    const phone = pick(html, "PHONE");
    expect(phone?.normalizedValue).toBe("+13055550142");
    expect(phone?.confidence).toBe(90);
    expect(phone?.source).toBe("SCRAPE_TEL");
  });

  test("body-text phone normalizes (digits-only +1) with conf 60", () => {
    const html = `<p>Front desk: (305) 555-0142</p>`;
    const phone = pick(html, "PHONE");
    expect(phone?.normalizedValue).toBe("+13055550142");
    expect(phone?.confidence).toBe(60);
  });

  test("dotted + dashed formats both normalize identically", () => {
    expect(pick(`<p>305.555.0142</p>`, "PHONE")?.normalizedValue).toBe(
      "+13055550142",
    );
    expect(pick(`<p>305-555-0142</p>`, "PHONE")?.normalizedValue).toBe(
      "+13055550142",
    );
  });

  test("dedupes the same number from tel: and body to the higher confidence", () => {
    const html = `
      <a href="tel:3055550142">call</a>
      <p>305-555-0142</p>`;
    const phones = parseContacts({ html, sourceUrl: SRC }).filter(
      (c) => c.channel === "PHONE",
    );
    expect(phones).toHaveLength(1);
    expect(phones[0].confidence).toBe(90); // href wins
  });
});

describe("parseContacts · socials", () => {
  test("maps each network to its channel with SOCIAL role + conf 70", () => {
    const html = `
      <a href="https://instagram.com/soleaspa">ig</a>
      <a href="https://www.facebook.com/soleaspa">fb</a>
      <a href="https://www.linkedin.com/company/solea">li</a>
      <a href="https://tiktok.com/@soleaspa">tt</a>
      <a href="https://youtube.com/@soleaspa">yt</a>
      <a href="https://x.com/soleaspa">x</a>
      <a href="https://www.yelp.com/biz/solea-spa">yelp</a>`;
    const got = channels(html);
    for (const ch of [
      "INSTAGRAM",
      "FACEBOOK",
      "LINKEDIN",
      "TIKTOK",
      "YOUTUBE",
      "X",
      "YELP",
    ] as const) {
      expect(got).toContain(ch);
    }
    const ig = pick(html, "INSTAGRAM");
    expect(ig?.role).toBe("SOCIAL");
    expect(ig?.confidence).toBe(70);
    expect(ig?.source).toBe("SCRAPE_SOCIAL_META");
    expect(ig?.normalizedValue).toBe("https://instagram.com/soleaspa");
  });

  test("ignores share / intent links", () => {
    const html = `<a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>`;
    expect(channels(html)).not.toContain("FACEBOOK");
  });

  test("ignores a bare social homepage (no profile path)", () => {
    const html = `<a href="https://facebook.com/">fb</a>`;
    expect(channels(html)).not.toContain("FACEBOOK");
  });
});

describe("parseContacts · booking", () => {
  test("a Calendly link → BOOKING_URL channel + BOOKING role", () => {
    const html = `<a href="https://calendly.com/solea-spa/consult">Book</a>`;
    const booking = pick(html, "BOOKING_URL");
    expect(booking?.role).toBe("BOOKING");
    expect(booking?.confidence).toBe(70);
  });

  test("recognises nexhealth / zocdoc / acuity booking hosts", () => {
    for (const host of [
      "https://soleaspa.nexhealth.com/book",
      "https://www.zocdoc.com/practice/solea-spa",
      "https://app.acuityscheduling.com/schedule.php?owner=123",
    ]) {
      expect(channels(`<a href="${host}">book</a>`)).toContain("BOOKING_URL");
    }
  });
});

describe("computeReachability", () => {
  test("0 channels → UNREACHABLE", () => {
    expect(computeReachability([]).status).toBe("UNREACHABLE");
    // BOOKING_URL / WEBSITE are destinations, not reach.
    expect(
      computeReachability([{ channel: "BOOKING_URL" }, { channel: "WEBSITE" }])
        .status,
    ).toBe("UNREACHABLE");
  });

  test("email only → EMAIL_ONLY", () => {
    const r = computeReachability([{ channel: "EMAIL" }]);
    expect(r.status).toBe("EMAIL_ONLY");
    expect(r.reachableChannelCount).toBe(1);
  });

  test("phone only → PHONE_ONLY", () => {
    expect(computeReachability([{ channel: "PHONE" }]).status).toBe(
      "PHONE_ONLY",
    );
  });

  test("two distinct channels → MULTI", () => {
    expect(
      computeReachability([{ channel: "EMAIL" }, { channel: "INSTAGRAM" }])
        .status,
    ).toBe("MULTI");
  });

  test("a single social channel → MULTI (usable touchpoint)", () => {
    expect(computeReachability([{ channel: "INSTAGRAM" }]).status).toBe(
      "MULTI",
    );
  });

  test("≥3 channels with email + phone → RICH", () => {
    const r = computeReachability([
      { channel: "EMAIL" },
      { channel: "PHONE" },
      { channel: "INSTAGRAM" },
    ]);
    expect(r.status).toBe("RICH");
    expect(r.reachableChannelCount).toBe(3);
  });

  test("≥3 channels WITHOUT both email + phone is MULTI not RICH", () => {
    const r = computeReachability([
      { channel: "EMAIL" },
      { channel: "INSTAGRAM" },
      { channel: "FACEBOOK" },
    ]);
    expect(r.status).toBe("MULTI");
  });

  test("end-to-end: parse a rich page → RICH", () => {
    const html = `
      <a href="mailto:info@soleaspa.com">email</a>
      <a href="tel:3055550142">call</a>
      <a href="https://instagram.com/soleaspa">ig</a>`;
    const contacts = parseContacts({ html, sourceUrl: SRC });
    expect(computeReachability(contacts).status).toBe("RICH");
  });
});

describe("isVendorEmail", () => {
  test("blocks gargle + wix + sentry + godaddy", () => {
    expect(isVendorEmail("webreporting@gargle.com")).toBe(true);
    expect(isVendorEmail("a@wixpress.com")).toBe(true);
    expect(isVendorEmail("b@o123.sentry.io")).toBe(true);
    expect(isVendorEmail("c@secureserver.net")).toBe(true);
  });

  test("allows a real business inbox", () => {
    expect(isVendorEmail("info@soleaspa.com")).toBe(false);
  });
});
