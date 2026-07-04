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
  extractJsonLd,
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
  test("bare 10-digit runs with invalid NANP structure → null (the junk bug)", () => {
    // These are the exact garbage values found in prod: timestamps, ids, etc.
    // normalized to +1XXXXXXXXXX by the old length-only check.
    expect(normalizePhone("1730683766")).toBeNull(); // area 173 invalid
    expect(normalizePhone("0003147565")).toBeNull(); // area 000 invalid
    expect(normalizePhone("1103207403")).toBeNull(); // area 110 invalid
    expect(normalizePhone("2110000000")).toBeNull(); // 211 N11 area
  });
  test("valid NANP with a 9 as area-code 2nd digit is kept (919, 909)", () => {
    expect(normalizePhone("919 555 0142")).toBe("+19195550142");
    expect(normalizePhone("(909) 555-0142")).toBe("+19095550142");
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

  test("drops the new junk classes (Wix-Sentry hash, placeholders)", () => {
    const html = `
      <span>605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com</span>
      <span>example@mysite.com</span>
      <span>nom@exemple.com</span>
      <span>maria@solea-spa.com</span>`;
    const out = extractEmails(html).map((o) => o.normalizedValue);
    expect(out).toEqual(["maria@solea-spa.com"]);
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

  test("ignores bare 10-digit numeric strings in page text (the +44-overflow bug)", () => {
    // A homepage full of timestamps / ids / prices must NOT become phones.
    const html = `<script>var t=1730683766;var id=3851262851;</script>
      <p>Est. 2003 · 5555266225 · order 8118512285</p>`;
    expect(extractPhones(html)).toHaveLength(0);
  });

  test("still keeps a correctly-formatted plaintext number", () => {
    const html = `<p>Call us: 250 491-9467 or (250) 860-6500</p>`;
    const out = extractPhones(html);
    expect(out.map((c) => c.normalizedValue).sort()).toEqual([
      "+12504919467",
      "+12508606500",
    ]);
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

  test("excludes site-builder template socials + FB namespace/API URLs", () => {
    // A Squarespace-built page: its template links Squarespace's OWN socials,
    // declares the fb XML namespace, and embeds a graph.facebook.com avatar —
    // none is the business's profile. Only the real page/handle survives.
    const html = `
      <html xmlns:fb="http://www.facebook.com/2008/fbml">
      <a href="https://www.facebook.com/squarespace/">Made with Squarespace</a>
      <a href="https://www.instagram.com/squarespace/">ig</a>
      <a href="https://twitter.com/squarespace">x</a>
      <img src="http://graph.facebook.com/792906679410/picture?type=square">
      <a href="https://www.facebook.com/reallygoodbread/">Our page</a>
      <a href="http://instagram.com/homesteadartisanbakery">Our IG</a>`;
    const out = extractSocials(html);
    const norm = out.map((o) => o.normalizedValue).sort();
    expect(norm).toEqual([
      "https://facebook.com/reallygoodbread",
      "https://instagram.com/homesteadartisanbakery",
    ]);
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

  test("excludes a leaked LinkedIn /admin management URL", () => {
    const html = `<a href="https://www.linkedin.com/company/19010443/admin/page-posts/published/">li</a>`;
    expect(extractSocials(html)).toHaveLength(0);
  });

  test("keeps a clean LinkedIn company profile", () => {
    const html = `<a href="https://www.linkedin.com/company/solea-spa/">li</a>`;
    const out = extractSocials(html);
    expect(out).toHaveLength(1);
    expect(out[0].channel).toBe("LINKEDIN");
  });

  test("unifies twitter.com and x.com for the same handle", () => {
    const html = `
      <a href="https://twitter.com/soleaspa">t</a>
      <a href="https://x.com/soleaspa">x</a>`;
    const out = extractSocials(html);
    expect(out).toHaveLength(1);
    expect(out[0].normalizedValue).toBe("https://x.com/soleaspa");
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

describe("extractJsonLd", () => {
  const LD = (obj: unknown) =>
    `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

  test("pulls email, telephone, and sameAs socials from LocalBusiness markup", () => {
    const html = LD({
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: "Solea Spa",
      email: "hello@soleaspa.com",
      telephone: "+1 (305) 555-0199",
      sameAs: [
        "https://www.facebook.com/soleaspa",
        "https://instagram.com/soleaspa",
      ],
    });
    const out = extractJsonLd(html);
    const emails = out.filter((c) => c.channel === "EMAIL");
    const phones = out.filter((c) => c.channel === "PHONE");
    const socials = out.filter(
      (c) => c.channel === "FACEBOOK" || c.channel === "INSTAGRAM",
    );
    expect(emails[0]?.normalizedValue).toBe("hello@soleaspa.com");
    expect(emails[0]?.source).toBe("SCRAPE_JSONLD");
    expect(phones[0]?.normalizedValue).toBe("+13055550199");
    expect(socials).toHaveLength(2);
  });

  test("recurses into a nested contactPoint", () => {
    const html = LD({
      "@type": "Organization",
      contactPoint: { "@type": "ContactPoint", telephone: "305-555-0123" },
    });
    const out = extractJsonLd(html);
    expect(out.find((c) => c.channel === "PHONE")?.normalizedValue).toBe(
      "+13055550123",
    );
  });

  test("malformed JSON-LD is skipped, never throws", () => {
    const bad = '<script type="application/ld+json">{bad</script>';
    expect(() => extractJsonLd(bad)).not.toThrow();
    expect(extractJsonLd(bad)).toEqual([]);
  });

  test("JSON-LD contacts flow through the unified roll-up", () => {
    const html = LD({ "@type": "LocalBusiness", email: "x@y.com" });
    const all = extractContactsFromHtml(html);
    expect(
      all.some((c) => c.channel === "EMAIL" && c.normalizedValue === "x@y.com"),
    ).toBe(true);
  });
});
