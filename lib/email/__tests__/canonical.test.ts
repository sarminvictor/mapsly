import { describe, expect, test } from "vitest";

import { canonicalEmail } from "../canonical";

describe("canonicalEmail", () => {
  test("strips +tag sub-addressing on any domain", () => {
    expect(canonicalEmail("tom+1@anchorlocal.com")).toBe("tom@anchorlocal.com");
    expect(canonicalEmail("tom+anything+more@outlook.com")).toBe(
      "tom@outlook.com",
    );
  });

  test("Gmail ignores dots in the local part; Googlemail too", () => {
    expect(canonicalEmail("t.o.m@gmail.com")).toBe("tom@gmail.com");
    expect(canonicalEmail("t.o.m+2@googlemail.com")).toBe("tom@googlemail.com");
  });

  test("does NOT strip dots on non-Gmail domains", () => {
    expect(canonicalEmail("first.last@anchorlocal.com")).toBe(
      "first.last@anchorlocal.com",
    );
  });

  test("lowercases + trims", () => {
    expect(canonicalEmail("  TOM@Gmail.COM ")).toBe("tom@gmail.com");
  });

  test("the farm variants all collapse to one canonical mailbox", () => {
    const canon = "tom@gmail.com";
    for (const v of [
      "tom@gmail.com",
      "tom+1@gmail.com",
      "tom+2@gmail.com",
      "t.o.m@gmail.com",
      "T.O.M+beta@GMAIL.com",
    ]) {
      expect(canonicalEmail(v)).toBe(canon);
    }
  });

  test("degrades gracefully on a malformed address", () => {
    expect(canonicalEmail("not-an-email")).toBe("not-an-email");
    expect(canonicalEmail("@nolocal.com")).toBe("@nolocal.com");
  });
});
