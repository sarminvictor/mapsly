// WP7-5 · disposable-email-domain blocklist (trial-abuse containment).

import { describe, expect, test } from "vitest";

import { isDisposableEmailDomain } from "../disposable-domains";

describe("isDisposableEmailDomain", () => {
  test("blocks well-known throwaway providers", () => {
    expect(isDisposableEmailDomain("a@mailinator.com")).toBe(true);
    expect(isDisposableEmailDomain("x@guerrillamail.com")).toBe(true);
    expect(isDisposableEmailDomain("y@10minutemail.com")).toBe(true);
    expect(isDisposableEmailDomain("z@yopmail.com")).toBe(true);
  });

  test("blocks subdomains of a listed provider", () => {
    expect(isDisposableEmailDomain("a@inbox.mailinator.com")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isDisposableEmailDomain("A@MailInator.COM")).toBe(true);
  });

  test("does NOT block real providers (agencies use these)", () => {
    expect(isDisposableEmailDomain("tom@gmail.com")).toBe(false);
    expect(isDisposableEmailDomain("tom@outlook.com")).toBe(false);
    expect(isDisposableEmailDomain("tom@anchorlocal.com")).toBe(false);
    // A brand domain that merely CONTAINS a listed name as a substring, not a
    // suffix, must not be blocked.
    expect(isDisposableEmailDomain("tom@notmailinator.com")).toBe(false);
    expect(isDisposableEmailDomain("tom@mailinator.com.example.com")).toBe(
      false,
    );
  });

  test("malformed input is not treated as disposable", () => {
    expect(isDisposableEmailDomain("no-at-sign")).toBe(false);
    expect(isDisposableEmailDomain("")).toBe(false);
    expect(isDisposableEmailDomain("trailing@")).toBe(false);
  });
});
