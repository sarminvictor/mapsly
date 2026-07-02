// WP6-2/WP6-3 · tests for the agency notification email senders.
//
// Invariants worth locking:
//   - Best-effort: with no RESEND key in env, a sender returns false (never
//     throws) so the caller degrades gracefully.
//   - A network error is swallowed → false (fire-and-forget contract).
//   - On a 2xx from Resend the sender returns true and posts to the transactional
//     endpoint with the mapsly.ai From address (never the cold-mailer path).
//   - The digest body escapes data-derived text (no HTML injection from a
//     research name).

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { sendRunFinished, sendAgencyDigest } from "../email";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "login@mapsly.ai";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("sendRunFinished", () => {
  test("no Resend key → false, no fetch", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.AUTH_RESEND_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const ok = await sendRunFinished({
      to: "tom@anchor.co",
      agencyName: "Anchor Local",
      workbenchUrl: "https://mapsly.ai/discover/d1",
      outcome: "OK",
      enriched: 12,
      failed: 0,
      refunded: 3,
    });
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("2xx → true, posts to Resend with the mapsly.ai From", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const ok = await sendRunFinished({
      to: "tom@anchor.co",
      agencyName: "Anchor Local",
      workbenchUrl: "https://mapsly.ai/discover/d1",
      outcome: "PARTIAL",
      enriched: 40,
      failed: 5,
      refunded: 6,
    });
    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init.body));
    expect(body.from).toBe("login@mapsly.ai");
    expect(body.to).toBe("tom@anchor.co");
    // honest PARTIAL summary carries the counts + refund
    expect(body.text).toContain("40");
    expect(body.text).toContain("5 couldn't complete");
    expect(body.text).toContain("6 credits refunded");
  });

  test("network error → false (never throws)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    await expect(
      sendRunFinished({
        to: "tom@anchor.co",
        agencyName: "Anchor Local",
        workbenchUrl: "https://mapsly.ai/discover/d1",
        outcome: "OK",
        enriched: 1,
        failed: 0,
        refunded: 0,
      }),
    ).resolves.toBe(false);
  });
});

describe("sendAgencyDigest", () => {
  test("escapes data-derived text in the HTML body", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    await sendAgencyDigest({
      to: "tom@anchor.co",
      agencyName: 'Anchor & "Local"',
      changes: [
        {
          label: "<script>bad</script> 3 new matches",
          url: "https://mapsly.ai/discover/d1",
        },
      ],
      researchUrl: "https://mapsly.ai/research",
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    // the raw <script> must be escaped in the HTML we send
    expect(body.html).not.toContain("<script>bad</script>");
    expect(body.html).toContain("&lt;script&gt;");
    // agency name escaped too
    expect(body.html).toContain("Anchor &amp; &quot;Local&quot;");
  });
});
