// Unit tests for services/lighthouse/dom-checks.
//
// These are pure-function tests over hand-rolled HTML fixtures. No
// network, no Prisma, no cron context. Every check has explicit positive
// and negative cases so a regression in regex / extraction is caught by
// a single failing assertion.
//
// Coverage scope:
//   - aboveFoldSlice + stripTags (helpers)
//   - extractJsonLdBlocks + collectJsonLdTypes (JSON-LD walk)
//   - hasLocalBusinessSchema (positive: LocalBusiness, MedicalBusiness,
//     Restaurant, @graph nesting; negative: WebSite, no schema)
//   - hasFaqSchema (positive + negative)
//   - extractPhoneNumbers + normalizePhone (formats + edge cases)
//   - hasPhoneAboveFold (positive + below-fold negative)
//   - hasBookingCtaAboveFold (every verb variant + negative)
//   - napConsistent (full match / each leg missing / null on incomplete input)
//   - runDomChecks (aggregated surface)

import { describe, expect, test } from "vitest";
import {
  ABOVE_FOLD_BYTES,
  BOOKING_CTA_VERBS,
  LOCAL_BUSINESS_TYPES,
  aboveFoldSlice,
  collectJsonLdTypes,
  extractJsonLdBlocks,
  extractPhoneNumbers,
  hasBookingCtaAboveFold,
  hasFaqSchema,
  hasLocalBusinessSchema,
  hasPhoneAboveFold,
  napConsistent,
  normalizePhone,
  normalizeText,
  runDomChecks,
  stripTags,
} from "../dom-checks";

// ---- Helpers -----------------------------------------------------------

function wrap(body: string, head = ""): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

function jsonLdScript(payload: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
}

// ---- Helpers · aboveFoldSlice + stripTags -------------------------------

describe("aboveFoldSlice", () => {
  test("starts at <body> when present", () => {
    const html = "<head>boilerplate</head><body>abc</body>";
    expect(aboveFoldSlice(html, 100)).toContain("<body>abc</body>");
  });
  test("starts at position 0 when no <body>", () => {
    expect(aboveFoldSlice("<div>x</div>", 100)).toBe("<div>x</div>");
  });
  test("caps at the configured byte budget", () => {
    const long = "<body>" + "x".repeat(20_000) + "</body>";
    expect(aboveFoldSlice(long, 100).length).toBe(100);
  });
  test("default budget is ABOVE_FOLD_BYTES", () => {
    const long = "<body>" + "x".repeat(20_000) + "</body>";
    expect(aboveFoldSlice(long).length).toBe(ABOVE_FOLD_BYTES);
  });
});

describe("stripTags", () => {
  test("removes tags, scripts, styles, comments", () => {
    const html =
      `<div>hi <script>var x=1;</script><style>.a{}</style>` +
      `<!-- comment --><b>there</b></div>`;
    expect(stripTags(html)).toBe("hi there");
  });
  test("decodes common entities", () => {
    expect(stripTags("<p>foo &amp; bar &nbsp;&#39;baz&apos;</p>")).toBe(
      "foo & bar 'baz'",
    );
  });
  test("collapses whitespace", () => {
    expect(stripTags("<p>  a   \n  b   </p>")).toBe("a b");
  });
});

// ---- JSON-LD walk -------------------------------------------------------

describe("extractJsonLdBlocks", () => {
  test("extracts a single well-formed block", () => {
    const html = wrap(
      "",
      jsonLdScript({ "@context": "https://schema.org", "@type": "LocalBusiness" }),
    );
    const blocks = extractJsonLdBlocks(html);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { ["@type"]: string })["@type"]).toBe("LocalBusiness");
  });
  test("expands top-level arrays", () => {
    const html = wrap(
      "",
      `<script type="application/ld+json">[{"@type":"LocalBusiness"},{"@type":"FAQPage"}]</script>`,
    );
    expect(extractJsonLdBlocks(html)).toHaveLength(2);
  });
  test("tolerates extra attrs on the script tag", () => {
    const html = `<script nonce="abc" type='application/ld+json' data-x="1">{"@type":"FAQPage"}</script>`;
    expect(extractJsonLdBlocks(html)).toHaveLength(1);
  });
  test("skips malformed JSON without throwing", () => {
    const html = `<script type="application/ld+json">{not json}</script><script type="application/ld+json">{"@type":"FAQPage"}</script>`;
    const blocks = extractJsonLdBlocks(html);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { ["@type"]: string })["@type"]).toBe("FAQPage");
  });
  test("ignores non-JSON-LD scripts", () => {
    const html = `<script>{"@type":"LocalBusiness"}</script><script type="text/javascript">var x=1;</script>`;
    expect(extractJsonLdBlocks(html)).toHaveLength(0);
  });
});

describe("collectJsonLdTypes", () => {
  test("collects scalar @type", () => {
    expect(collectJsonLdTypes({ "@type": "LocalBusiness" })).toEqual([
      "LocalBusiness",
    ]);
  });
  test("collects array @type", () => {
    expect(
      collectJsonLdTypes({ "@type": ["LocalBusiness", "MedicalBusiness"] }),
    ).toEqual(["LocalBusiness", "MedicalBusiness"]);
  });
  test("descends into @graph", () => {
    expect(
      collectJsonLdTypes({
        "@graph": [{ "@type": "WebSite" }, { "@type": "FAQPage" }],
      }),
    ).toEqual(["WebSite", "FAQPage"]);
  });
  test("descends into nested entities", () => {
    expect(
      collectJsonLdTypes({
        "@type": "LocalBusiness",
        address: { "@type": "PostalAddress" },
      }),
    ).toEqual(["LocalBusiness", "PostalAddress"]);
  });
});

// ---- hasLocalBusinessSchema --------------------------------------------

describe("hasLocalBusinessSchema", () => {
  test("true for explicit LocalBusiness", () => {
    expect(
      hasLocalBusinessSchema(
        wrap("", jsonLdScript({ "@type": "LocalBusiness" })),
      ),
    ).toBe(true);
  });
  test("true for MedicalBusiness (subtype)", () => {
    expect(
      hasLocalBusinessSchema(
        wrap("", jsonLdScript({ "@type": "MedicalBusiness" })),
      ),
    ).toBe(true);
  });
  test("true for Restaurant subtype", () => {
    expect(
      hasLocalBusinessSchema(
        wrap("", jsonLdScript({ "@type": "Restaurant" })),
      ),
    ).toBe(true);
  });
  test("true inside @graph layout", () => {
    expect(
      hasLocalBusinessSchema(
        wrap(
          "",
          jsonLdScript({
            "@context": "https://schema.org",
            "@graph": [
              { "@type": "WebSite" },
              { "@type": "HairSalon" },
            ],
          }),
        ),
      ),
    ).toBe(true);
  });
  test("false when no schema present", () => {
    expect(hasLocalBusinessSchema(wrap("hello world"))).toBe(false);
  });
  test("false when only WebSite/Organization markup", () => {
    expect(
      hasLocalBusinessSchema(wrap("", jsonLdScript({ "@type": "WebSite" }))),
    ).toBe(false);
  });
  test("LOCAL_BUSINESS_TYPES is non-empty", () => {
    expect(LOCAL_BUSINESS_TYPES.size).toBeGreaterThan(10);
    expect(LOCAL_BUSINESS_TYPES.has("LocalBusiness")).toBe(true);
  });
});

// ---- hasFaqSchema ------------------------------------------------------

describe("hasFaqSchema", () => {
  test("true for FAQPage", () => {
    expect(hasFaqSchema(wrap("", jsonLdScript({ "@type": "FAQPage" })))).toBe(
      true,
    );
  });
  test("false for LocalBusiness only", () => {
    expect(
      hasFaqSchema(wrap("", jsonLdScript({ "@type": "LocalBusiness" }))),
    ).toBe(false);
  });
  test("true in @graph alongside LocalBusiness", () => {
    expect(
      hasFaqSchema(
        wrap(
          "",
          jsonLdScript({
            "@graph": [{ "@type": "LocalBusiness" }, { "@type": "FAQPage" }],
          }),
        ),
      ),
    ).toBe(true);
  });
});

// ---- Phone extraction --------------------------------------------------

describe("normalizePhone", () => {
  test("strips leading 1 from 11-digit", () => {
    expect(normalizePhone("13055550100")).toBe("3055550100");
  });
  test("returns 10-digit unchanged", () => {
    expect(normalizePhone("3055550100")).toBe("3055550100");
  });
  test("strips formatting", () => {
    expect(normalizePhone("(305) 555-0100")).toBe("3055550100");
  });
  test("preserves non-NA-shape digits", () => {
    expect(normalizePhone("4412345678901")).toBe("4412345678901");
  });
});

describe("extractPhoneNumbers", () => {
  test("matches (305) 555-0100", () => {
    expect(extractPhoneNumbers("Call (305) 555-0100 today")).toEqual(
      new Set(["3055550100"]),
    );
  });
  test("matches 305.555.0100", () => {
    expect(extractPhoneNumbers("ph 305.555.0100")).toEqual(
      new Set(["3055550100"]),
    );
  });
  test("matches +1 305 555 0100", () => {
    expect(extractPhoneNumbers("+1 305 555 0100")).toEqual(
      new Set(["3055550100"]),
    );
  });
  test("matches tel: link", () => {
    expect(
      extractPhoneNumbers(`<a href="tel:+13055550100">Call</a>`),
    ).toEqual(new Set(["3055550100"]));
  });
  test("ignores plain digit runs that aren't phone-shaped", () => {
    expect(extractPhoneNumbers("Order #12345").size).toBe(0);
  });
  test("ignores 9-digit and shorter sequences", () => {
    expect(extractPhoneNumbers("305-555-010").size).toBe(0);
  });
  test("dedups across formats", () => {
    expect(
      extractPhoneNumbers(
        "Call (305) 555-0100 or 305-555-0100 or +1 305 555 0100",
      ),
    ).toEqual(new Set(["3055550100"]));
  });
});

// ---- hasPhoneAboveFold -------------------------------------------------

describe("hasPhoneAboveFold", () => {
  test("true when phone is in the body intro", () => {
    expect(
      hasPhoneAboveFold(wrap("Welcome! Call us at (305) 555-0100.")),
    ).toBe(true);
  });
  test("true when tel: href present without visible digits", () => {
    expect(
      hasPhoneAboveFold(wrap(`<a href="tel:+13055550100">Call us</a>`)),
    ).toBe(true);
  });
  test("false when phone only appears below the fold", () => {
    const padding = "x ".repeat(4_000);
    expect(
      hasPhoneAboveFold(wrap(`${padding}Phone (305) 555-0100`)),
    ).toBe(false);
  });
  test("false when no phone anywhere", () => {
    expect(hasPhoneAboveFold(wrap("welcome to our spa"))).toBe(false);
  });
});

// ---- hasBookingCtaAboveFold --------------------------------------------

describe("hasBookingCtaAboveFold", () => {
  test("matches every documented verb", () => {
    for (const verb of BOOKING_CTA_VERBS) {
      expect(hasBookingCtaAboveFold(wrap(`<button>${verb}</button>`))).toBe(
        true,
      );
    }
  });
  test("is case-insensitive", () => {
    expect(hasBookingCtaAboveFold(wrap(`<a>Book Now</a>`))).toBe(true);
    expect(hasBookingCtaAboveFold(wrap(`<a>BOOK ONLINE</a>`))).toBe(true);
  });
  test("false on unrelated copy", () => {
    expect(hasBookingCtaAboveFold(wrap(`<p>About us</p>`))).toBe(false);
  });
  test("false when CTA is below the fold", () => {
    const padding = "x ".repeat(4_000);
    expect(hasBookingCtaAboveFold(wrap(`${padding}<a>Book Now</a>`))).toBe(
      false,
    );
  });
});

// ---- napConsistent -----------------------------------------------------

describe("napConsistent", () => {
  const sample = wrap(
    "<h1>Solea Brickell Spa</h1>" +
      "<p>1450 Brickell Ave, Miami, FL 33131</p>" +
      "<p>Call (305) 555-0100</p>",
  );

  test("returns true when name, address chunk, and phone all match", () => {
    expect(
      napConsistent(sample, {
        name: "Solea Brickell Spa",
        address: "1450 Brickell Ave, Miami, FL 33131",
        phone: "(305) 555-0100",
      }),
    ).toBe(true);
  });
  test("returns true with phone in alt format", () => {
    expect(
      napConsistent(sample, {
        name: "Solea Brickell Spa",
        address: "1450 Brickell Ave, Miami, FL 33131",
        phone: "+1 305-555-0100",
      }),
    ).toBe(true);
  });
  test("returns false when phone mismatches", () => {
    expect(
      napConsistent(sample, {
        name: "Solea Brickell Spa",
        address: "1450 Brickell Ave",
        phone: "(305) 555-0199",
      }),
    ).toBe(false);
  });
  test("returns false when name mismatches", () => {
    expect(
      napConsistent(sample, {
        name: "Some Other Spa",
        address: "1450 Brickell Ave",
        phone: "(305) 555-0100",
      }),
    ).toBe(false);
  });
  test("returns false when no address chunk matches", () => {
    expect(
      napConsistent(sample, {
        name: "Solea Brickell Spa",
        address: "99999 Made Up Street, Nowhere, ZZ 99999",
        phone: "(305) 555-0100",
      }),
    ).toBe(false);
  });
  test("returns null when input incomplete", () => {
    expect(
      napConsistent(sample, {
        name: "Solea Brickell Spa",
        address: "",
        phone: "(305) 555-0100",
      }),
    ).toBeNull();
  });
});

// ---- normalizeText -----------------------------------------------------

describe("normalizeText", () => {
  test("lowercases + collapses punctuation", () => {
    expect(normalizeText("Solea Brickell Spa, LLC.")).toBe(
      "solea brickell spa llc",
    );
  });
  test("preserves Unicode letters", () => {
    expect(normalizeText("Café Olé")).toBe("café olé");
  });
});

// ---- runDomChecks aggregator -------------------------------------------

describe("runDomChecks", () => {
  test("aggregates all check verdicts", () => {
    const html = wrap(
      `<h1>Solea Brickell Spa</h1>` +
        `<p>1450 Brickell Ave, Miami, FL 33131</p>` +
        `<a href="tel:+13055550100">(305) 555-0100</a>` +
        `<button>Book Now</button>`,
      jsonLdScript({ "@type": "MedicalBusiness" }) +
        jsonLdScript({ "@type": "FAQPage" }),
    );
    expect(
      runDomChecks({
        html,
        nap: {
          name: "Solea Brickell Spa",
          address: "1450 Brickell Ave, Miami, FL 33131",
          phone: "(305) 555-0100",
        },
      }),
    ).toEqual({
      hasLocalBusinessSchema: true,
      hasFaqSchema: true,
      hasPhoneAboveFold: true,
      hasBookingCtaAboveFold: true,
      napConsistent: true,
    });
  });
  test("returns null napConsistent when input incomplete", () => {
    const result = runDomChecks({
      html: wrap("hello"),
      nap: { name: "Foo" },
    });
    expect(result.napConsistent).toBeNull();
  });
  test("returns all-false when HTML is empty", () => {
    expect(runDomChecks({ html: "" })).toEqual({
      hasLocalBusinessSchema: false,
      hasFaqSchema: false,
      hasPhoneAboveFold: false,
      hasBookingCtaAboveFold: false,
      napConsistent: null,
    });
  });
});
