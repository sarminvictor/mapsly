import { describe, expect, test } from "vitest";
import { cleanWebsiteUrl } from "../clean-website-url";

describe("cleanWebsiteUrl", () => {
  test("strips GMB/UTM tracking params, keeps origin + path", () => {
    expect(
      cleanWebsiteUrl(
        "https://www.theinjectionist.ca/?utm_source=Google&utm_medium=GMB",
      ),
    ).toBe("https://www.theinjectionist.ca/");
  });

  test("strips any query string", () => {
    expect(cleanWebsiteUrl("https://x.com/services?id=5&ref=a")).toBe(
      "https://x.com/services",
    );
  });

  test("strips the fragment", () => {
    expect(cleanWebsiteUrl("https://x.com/page#book")).toBe(
      "https://x.com/page",
    );
  });

  test("leaves an already-clean URL unchanged", () => {
    expect(cleanWebsiteUrl("https://x.com/about")).toBe("https://x.com/about");
    expect(cleanWebsiteUrl("https://x.com/")).toBe("https://x.com/");
  });

  test("trims surrounding whitespace", () => {
    expect(cleanWebsiteUrl("  https://x.com/?a=1  ")).toBe("https://x.com/");
  });

  test("null / empty → null", () => {
    expect(cleanWebsiteUrl(null)).toBeNull();
    expect(cleanWebsiteUrl(undefined)).toBeNull();
    expect(cleanWebsiteUrl("")).toBeNull();
    expect(cleanWebsiteUrl("   ")).toBeNull();
  });

  test("unparseable / scheme-less input kept as-is (no data loss)", () => {
    expect(cleanWebsiteUrl("example.com")).toBe("example.com");
  });

  test("non-http protocol kept as-is", () => {
    expect(cleanWebsiteUrl("mailto:hi@x.com")).toBe("mailto:hi@x.com");
  });
});
