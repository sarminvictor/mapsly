/**
 * Contact extractor invariants · Phase 4
 *
 * Golden tests over `modules/contacts/extract.ts`. A missed contact = a
 * business that looks unreachable and drops out of every list, so these cover:
 *   - mailto: + tel: href extraction (high confidence)
 *   - plaintext email + phone regex (lower confidence)
 *   - junk email rejection (sentry, example.com, image artefacts)
 *   - social profile URL detection per network
 *   - exclusion of share / intent / widget links
 *   - de-dupe by (channel, normalizedValue) keeping the higher confidence
 *   - E.164 phone normalization
 */

import { describe, expect, test } from "vitest";
import {
  extractContactsFromHtml,
  extractEmails,
  extractPhones,
  extractSocials,
  normalizeEmail,
  normalizePhone,
  type ContactChannel,
} from "@/modules/contacts/extract";

/** Helper: get the set of normalized values for a given channel. */
function valuesFor(
  contacts: ReadonlyArray<{ channel: ContactChannel; normalizedValue: string }>,
  channel: ContactChannel,
): string[] {
  return contacts
    .filter((c) => c.channel === channel)
    .map((c) => c.normalizedValue)
    .sort();
}

describe("normalizeEmail", () => {
  test("lower-cases and trims", () => {
    expect(normalizeEmail("  Hello@Example.COM ")).toBe("hello@example.com");
  });
});

describe("normalizePhone", () => {
  test("10-digit US number → +1XXXXXXXXXX", () => {
    expect(normalizePhone("(305) 555-0142")).toBe("+13055550142");
  });
  test("11-digit with leading 1 → +1XXXXXXXXXX", () => {
    expect(normalizePhone("1-305-555-0142")).toBe("+13055550142");
  });
  test("already +1 prefixed", () => {
    expect(normalizePhone("+1 305 555 0142")).toBe("+13055550142");
  });
  test("too few digits → null", () => {
    expect(normalizePhone("123-45")).toBeNull();
  });
  test("too many digits → null", () => {
    expect(normalizePhone("+44 20 7946 0958 99")).toBeNull();
  });
});

describe("extractEmails", () => {
  test("pulls mailto: hrefs at high confidence", () => {
    const html = `<a href="mailto:owner@solea-spa.com">Email us</a>`;
    const out = extractEmails(html);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      channel: "EMAIL",
      normalizedValue: "owner@solea-spa.com",
      source: "SCRAPE_MAILTO",
      confidence: 95,
    });
  });

  test("pulls plaintext emails at lower confidence", () => {
    const html = `<p>Reach us at Hello@Solea-Spa.com any time.</p>`;
    const out = extractEmails(html);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      normalizedValue: "hello@solea-spa.com",
      source: "SCRAPE_HOMEPAGE",
      confidence: 60,
    });
  });

  test("mailto wins over plaintext for the same address (dedupe by confidence)", () => {
    const html = `
      <a href="mailto:info@solea-spa.com">mail</a>
      <span>info@solea-spa.com</span>`;
    const out = extractEmails(html);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("SCRAPE_MAILTO");
    expect(out[0].confidence).toBe(95);
  });

  test("drops sentry / example.com / image-artefact junk", () => {
    const html = `
      <a href="mailto:abc123@sentry.wixpress.com">x</a>
      <span>noreply@example.com</span>
      <span>logo@2x.png</span>
      <span>real@solea-spa.com</span>`;
    const out = extractEmails(html);
    const vals = out.map((o) => o.normalizedValue);
    expect(vals).toEqual(["real@solea-spa.com"]);
  });

  test("decodes &amp; entities inside mailto", () => {
    const html = `<a href="mailto:hi@solea-spa.com?subject=Hi&amp;body=Yo">m</a>`;
    const out = extractEmails(html);
    expect(out[0].normalizedValue).toBe("hi@solea-spa.com");
  });
});

describe("extractPhones", () => {
  test("pulls tel: hrefs at high confidence and normalizes to E.164", () => {
    const html = `<a href="tel:+1 (305) 555-0142">Call</a>`;
    const out = extractPhones(html);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      channel: "PHONE",
      normalizedValue: "+13055550142",
      source: "SCRAPE_TEL",
      confidence: 95,
    });
  });

  test("pulls plaintext phones at lower confidence", () => {
    const html = `<p>Front desk: 305.555.0142</p>`;
    const out = extractPhones(html);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      normalizedValue: "+13055550142",
      source: "SCRAPE_HOMEPAGE",
      confidence: 60,
    });
  });

  test("tel wins over plaintext for the same number (dedupe by confidence)", () => {
    const html = `
      <a href="tel:3055550142">call</a>
      <span>(305) 555-0142</span>`;
    const out = extractPhones(html);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("SCRAPE_TEL");
  });

  test("ignores non-NANP junk runs", () => {
    const html = `<p>order #12-34 ref 999</p>`;
    expect(extractPhones(html)).toHaveLength(0);
  });
});

describe("extractSocials", () => {
  test("detects each network from href profile URLs", () => {
    const html = `
      <a href="https://facebook.com/SoleaSpa">fb</a>
      <a href="https://www.instagram.com/solea.spa">ig</a>
      <a href="https://linkedin.com/company/solea-spa">li</a>
      <a href="https://www.tiktok.com/@soleaspa">tt</a>
      <a href="https://youtube.com/@SoleaSpa">yt</a>
      <a href="https://x.com/soleaspa">x</a>
      <a href="https://www.yelp.com/biz/solea-spa-miami">yelp</a>
      <a href="https://wa.me/13055550142">wa</a>`;
    const out = extractSocials(html);
    const channels = out.map((o) => o.channel).sort();
    expect(channels).toEqual(
      [
        "FACEBOOK",
        "INSTAGRAM",
        "LINKEDIN",
        "TIKTOK",
        "WHATSAPP",
        "X",
        "YELP",
        "YOUTUBE",
      ].sort(),
    );
    for (const o of out) {
      expect(o.source).toBe("SCRAPE_SOCIAL_META");
      expect(o.confidence).toBe(90);
    }
  });

  test("detects twitter.com as channel X", () => {
    const out = extractSocials(`<a href="https://twitter.com/soleaspa">t</a>`);
    expect(out).toHaveLength(1);
    expect(out[0].channel).toBe("X");
  });

  test("excludes facebook sharer / twitter intent / share widgets", () => {
    const html = `
      <a href="https://www.facebook.com/sharer/sharer.php?u=https://solea-spa.com">Share</a>
      <a href="https://twitter.com/intent/tweet?text=hi">Tweet</a>
      <a href="https://www.facebook.com/plugins/like.php">Like</a>
      <a href="https://youtube.com/watch?v=abc123">video</a>`;
    expect(extractSocials(html)).toHaveLength(0);
  });

  test("keeps a real FB page even when share links are also present", () => {
    const html = `
      <a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
      <a href="https://www.facebook.com/SoleaSpaMiami">Our page</a>`;
    const out = extractSocials(html);
    expect(out).toHaveLength(1);
    expect(out[0].channel).toBe("FACEBOOK");
    expect(out[0].normalizedValue).toBe("https://facebook.com/soleaspamiami");
  });

  test("resolves relative URLs against baseUrl", () => {
    const html = `<a href="/biz/solea-spa-miami">on yelp</a>`;
    const out = extractSocials(html, "https://www.yelp.com/");
    expect(out).toHaveLength(1);
    expect(out[0].channel).toBe("YELP");
  });

  test("detects bare URLs in body text (no href)", () => {
    const html = `<p>Find us at https://instagram.com/solea.spa daily.</p>`;
    const out = extractSocials(html);
    expect(out).toHaveLength(1);
    expect(out[0].channel).toBe("INSTAGRAM");
  });

  test("de-dupes http/https/www/trailing-slash variants of the same profile", () => {
    const html = `
      <a href="http://facebook.com/SoleaSpa/">a</a>
      <a href="https://www.facebook.com/soleaspa">b</a>`;
    const out = extractSocials(html);
    expect(out).toHaveLength(1);
  });
});

describe("extractContactsFromHtml", () => {
  test("unifies emails, phones, and socials into one de-duped list", () => {
    const html = `
      <a href="mailto:info@solea-spa.com">mail</a>
      <span>info@solea-spa.com</span>
      <a href="tel:3055550142">call</a>
      <a href="https://instagram.com/solea.spa">ig</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>`;
    const out = extractContactsFromHtml(html);

    expect(valuesFor(out, "EMAIL")).toEqual(["info@solea-spa.com"]);
    expect(valuesFor(out, "PHONE")).toEqual(["+13055550142"]);
    expect(valuesFor(out, "INSTAGRAM")).toEqual([
      "https://instagram.com/solea.spa",
    ]);
    // Share widget excluded.
    expect(out.some((c) => c.channel === "FACEBOOK")).toBe(false);
  });

  test("keeps the highest-confidence source on cross-source dedupe", () => {
    const html = `
      <a href="mailto:info@solea-spa.com">m</a>
      <p>info@solea-spa.com</p>`;
    const out = extractContactsFromHtml(html);
    const email = out.find((c) => c.channel === "EMAIL");
    expect(email?.source).toBe("SCRAPE_MAILTO");
    expect(email?.confidence).toBe(95);
  });

  test("empty html → empty list", () => {
    expect(extractContactsFromHtml("")).toEqual([]);
  });
});
