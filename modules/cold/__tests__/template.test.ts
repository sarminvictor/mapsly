import { describe, expect, test } from "vitest";

import { buildTextFooter, renderTemplate, toHtmlBody } from "../template";

const ADDRESS = "Mapsly · 530 3 St SE, Calgary, AB, Canada";

describe("renderTemplate", () => {
  const tokens = {
    businessName: "Acme",
    city: "Miami",
    unansweredCount: "6",
    rating: "",
  };

  test("substitutes tokens", () => {
    expect(renderTemplate("Hi {{businessName}} in {{city}}", tokens)).toBe(
      "Hi Acme in Miami",
    );
  });

  test("{{#if}} shows on truthy, hides on empty/zero/missing", () => {
    expect(
      renderTemplate(
        "{{#if unansweredCount}}{{unansweredCount}} reviews{{/if}}",
        tokens,
      ),
    ).toBe("6 reviews");
    expect(renderTemplate("{{#if rating}}{{rating}}★{{/if}}", tokens)).toBe("");
    expect(renderTemplate("{{#if missing}}x{{/if}}", tokens)).toBe("");
    expect(renderTemplate("{{#if zero}}x{{/if}}", { zero: "0" })).toBe("");
  });

  test("{{#unless}} is the inverse", () => {
    expect(
      renderTemplate("{{#unless rating}}no rating{{/unless}}", tokens),
    ).toBe("no rating");
    expect(renderTemplate("{{#unless businessName}}x{{/unless}}", tokens)).toBe(
      "",
    );
  });

  test("missing token renders empty", () => {
    expect(renderTemplate("a{{nope}}b", tokens)).toBe("ab");
  });
});

describe("spintax", () => {
  test("picks one of the options", () => {
    const out = renderTemplate("{{Hi|Hello|Hey}} there", {}, "seed-1");
    expect(["Hi there", "Hello there", "Hey there"]).toContain(out);
  });

  test("is deterministic for the same seed (retry renders identical copy)", () => {
    const tpl = "{{a|b|c}} {{d|e|f}} {{g|h|i}}";
    expect(renderTemplate(tpl, {}, "rcpt-123:0")).toBe(
      renderTemplate(tpl, {}, "rcpt-123:0"),
    );
  });

  test("varies across seeds (anti-fingerprinting)", () => {
    const tpl =
      "{{a|b|c|d}} {{e|f|g|h}} {{i|j|k|l}} {{m|n|o|p}} {{q|r|s|t}} {{u|v|w|x}}";
    const outputs = new Set(
      Array.from({ length: 20 }, (_n, i) => renderTemplate(tpl, {}, `s${i}`)),
    );
    expect(outputs.size).toBeGreaterThan(1);
  });

  test("does not touch tokens or conditionals", () => {
    const out = renderTemplate(
      "{{#if city}}{{Greetings|Hello}} {{businessName}} in {{city}}{{/if}}",
      { businessName: "Acme", city: "Miami" },
      "x",
    );
    expect(["Greetings Acme in Miami", "Hello Acme in Miami"]).toContain(out);
  });
});

describe("buildTextFooter", () => {
  test("contains the physical postal address (CAN-SPAM) + unsubscribe line", () => {
    const f = buildTextFooter("https://x/u/t", ADDRESS);
    expect(f).toContain("Unsubscribe: https://x/u/t");
    expect(f).toContain("Calgary");
    expect(f).toContain(ADDRESS);
  });
});

describe("toHtmlBody", () => {
  test("renders postal address + compact unsubscribe link, linkifies body URLs", () => {
    const html = toHtmlBody(
      "See it: https://www.mapsly.ai/l/abc",
      "https://www.mapsly.ai/u/t",
      ADDRESS,
    );
    expect(html).toContain('<a href="https://www.mapsly.ai/u/t"');
    expect(html).toContain(">Unsubscribe<");
    expect(html).toContain('<a href="https://www.mapsly.ai/l/abc"');
    expect(html).toContain("Calgary");
  });

  test("escapes HTML in the body", () => {
    expect(toHtmlBody("a <b> & c", "https://x/u/t", ADDRESS)).toContain(
      "a &lt;b&gt; &amp; c",
    );
  });
});
