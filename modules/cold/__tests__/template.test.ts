import { describe, expect, test } from "vitest";

import { buildTextFooter, renderTemplate, toHtmlBody } from "../template";

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

describe("buildTextFooter", () => {
  test("adds a minimal unsubscribe line, no postal address", () => {
    const f = buildTextFooter("https://x/u/t");
    expect(f).toContain("Unsubscribe: https://x/u/t");
    expect(f).not.toMatch(/Calgary|St SE|Inc/);
  });
});

describe("toHtmlBody", () => {
  test("renders a compact unsubscribe link + linkifies body URLs", () => {
    const html = toHtmlBody(
      "See it: https://www.mapsly.ai/l/abc",
      "https://www.mapsly.ai/u/t",
    );
    expect(html).toContain('<a href="https://www.mapsly.ai/u/t"');
    expect(html).toContain(">Unsubscribe<");
    expect(html).toContain('<a href="https://www.mapsly.ai/l/abc"');
  });

  test("escapes HTML in the body", () => {
    expect(toHtmlBody("a <b> & c", "https://x/u/t")).toContain(
      "a &lt;b&gt; &amp; c",
    );
  });
});
