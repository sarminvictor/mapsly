// Tests for the R3 dom-fetch outcome taxonomy (audit §9). The invariant: a
// Cloudflare-walled or timed-out fetch (the ERR_TIMED_OUT dead-URL class) must
// classify as a RETRYABLE silent failure — NEVER as a clean empty — while a
// genuinely thin page that reached content is verified-empty (not retried).

import { describe, expect, test } from "vitest";

import {
  classifyDomFetch,
  domFetchReachedContent,
  domFetchIsRetryable,
  DOM_EMPTY_BYTE_THRESHOLD,
} from "../outcome";

describe("classifyDomFetch", () => {
  test("a blocked flag → blocked (Cloudflare wall)", () => {
    expect(classifyDomFetch({ blocked: true })).toBe("blocked");
  });

  test("a 403 status → blocked even without the flag", () => {
    expect(classifyDomFetch({ status: 403 })).toBe("blocked");
  });

  test("failed + a timeout-looking error → timeout", () => {
    expect(
      classifyDomFetch({
        failed: true,
        error: "ERR_TIMED_OUT at blkmktsmp.com",
      }),
    ).toBe("timeout");
    expect(
      classifyDomFetch({
        failed: true,
        error: "Navigation timeout of 35000ms",
      }),
    ).toBe("timeout");
  });

  test("failed with a non-timeout error → error", () => {
    expect(
      classifyDomFetch({ failed: true, error: "net::ERR_NAME_NOT_RESOLVED" }),
    ).toBe("error");
  });

  test("no html and no flags → error (nothing reached content)", () => {
    expect(classifyDomFetch({ htmlBytes: 0 })).toBe("error");
    expect(classifyDomFetch({})).toBe("error");
  });

  test("html above the empty threshold → ok", () => {
    expect(classifyDomFetch({ htmlBytes: DOM_EMPTY_BYTE_THRESHOLD })).toBe(
      "ok",
    );
    expect(classifyDomFetch({ htmlBytes: 50_000, status: 200 })).toBe("ok");
  });

  test("html present but below the threshold → empty_verified (reached content)", () => {
    expect(classifyDomFetch({ htmlBytes: DOM_EMPTY_BYTE_THRESHOLD - 1 })).toBe(
      "empty_verified",
    );
  });

  test("a block takes precedence over a present-but-tiny body", () => {
    // A challenge page can carry a little HTML — the blocked flag/403 wins.
    expect(classifyDomFetch({ blocked: true, htmlBytes: 200 })).toBe("blocked");
    expect(classifyDomFetch({ status: 403, htmlBytes: 200 })).toBe("blocked");
  });
});

describe("outcome predicates", () => {
  test("ok / empty_verified reached content; the rest did not", () => {
    expect(domFetchReachedContent("ok")).toBe(true);
    expect(domFetchReachedContent("empty_verified")).toBe(true);
    expect(domFetchReachedContent("blocked")).toBe(false);
    expect(domFetchReachedContent("timeout")).toBe(false);
    expect(domFetchReachedContent("error")).toBe(false);
  });

  test("block/timeout/error are retryable; reached-content outcomes are not", () => {
    expect(domFetchIsRetryable("blocked")).toBe(true);
    expect(domFetchIsRetryable("timeout")).toBe(true);
    expect(domFetchIsRetryable("error")).toBe(true);
    expect(domFetchIsRetryable("ok")).toBe(false);
    expect(domFetchIsRetryable("empty_verified")).toBe(false);
  });
});
