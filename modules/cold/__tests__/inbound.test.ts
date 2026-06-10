import { describe, expect, test } from "vitest";

import { classifyInbound, extractBouncedEmail } from "../inbound";

const CRLF = "\r\n";

function raw(headers: Record<string, string>, body = ""): string {
  return (
    Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join(CRLF) +
    CRLF +
    CRLF +
    body
  );
}

describe("classifyInbound · bounces", () => {
  test("RFC 3464 DSN from mailer-daemon → hard bounce with recipient", () => {
    const source = raw(
      {
        From: "Mail Delivery Subsystem <mailer-daemon@zohocloud.ca>",
        Subject: "Delivery Status Notification (Failure)",
        "Content-Type": "multipart/report; report-type=delivery-status",
      },
      [
        "Final-Recipient: rfc822; dead@example.com",
        "Action: failed",
        "Status: 5.1.1",
      ].join(CRLF),
    );
    const c = classifyInbound({
      from: "mailer-daemon@zohocloud.ca",
      subject: "Delivery Status Notification (Failure)",
      source,
    });
    expect(c.kind).toBe("bounce");
    expect(c.hardBounce).toBe(true);
    expect(c.bouncedEmail).toBe("dead@example.com");
  });

  test("4.x.x DSN is a soft bounce", () => {
    const source = raw(
      { From: "postmaster@remote.com", Subject: "Undeliverable: hello" },
      ["Final-Recipient: rfc822; <full@example.com>", "Status: 4.2.2"].join(
        CRLF,
      ),
    );
    const c = classifyInbound({
      from: "postmaster@remote.com",
      subject: "Undeliverable: hello",
      source,
    });
    expect(c.kind).toBe("bounce");
    expect(c.hardBounce).toBe(false);
    expect(c.bouncedEmail).toBe("full@example.com");
  });

  test("failure subject without DSN status defaults to hard", () => {
    const source = raw(
      { From: "MAILER-DAEMON@mx.example.net", Subject: "Mail delivery failed" },
      "X-Failed-Recipients: gone@example.org",
    );
    const c = classifyInbound({
      from: "mailer-daemon@mx.example.net",
      subject: "Mail delivery failed",
      source,
    });
    expect(c.kind).toBe("bounce");
    expect(c.hardBounce).toBe(true);
    expect(c.bouncedEmail).toBe("gone@example.org");
  });
});

describe("classifyInbound · auto-replies", () => {
  test("Auto-Submitted: auto-replied → auto-reply (sequence continues)", () => {
    const source = raw({
      From: "maria@spa.com",
      Subject: "Re: your snapshot",
      "Auto-Submitted": "auto-replied",
    });
    expect(
      classifyInbound({
        from: "maria@spa.com",
        subject: "Re: your snapshot",
        source,
      }).kind,
    ).toBe("auto-reply");
  });

  test("out-of-office subject → auto-reply", () => {
    const source = raw({ From: "x@y.com", Subject: "Out of Office: back Mon" });
    expect(
      classifyInbound({
        from: "x@y.com",
        subject: "Out of Office: back Mon",
        source,
      }).kind,
    ).toBe("auto-reply");
  });
});

describe("classifyInbound · unsubscribes + replies", () => {
  test("'unsubscribe' subject → unsubscribe", () => {
    const source = raw({ From: "owner@biz.com", Subject: "unsubscribe" });
    expect(
      classifyInbound({ from: "owner@biz.com", subject: "unsubscribe", source })
        .kind,
    ).toBe("unsubscribe");
  });

  test("'remove me' in the body → unsubscribe", () => {
    const source = raw(
      { From: "owner@biz.com", Subject: "Re: quick look" },
      "Please remove me from your list.",
    );
    expect(
      classifyInbound({
        from: "owner@biz.com",
        subject: "Re: quick look",
        source,
      }).kind,
    ).toBe("unsubscribe");
  });

  test("a human reply → reply", () => {
    const source = raw(
      { From: "owner@biz.com", Subject: "Re: your Google profile" },
      "Yes — send the report over, sounds interesting.",
    );
    expect(
      classifyInbound({
        from: "owner@biz.com",
        subject: "Re: your Google profile",
        source,
      }).kind,
    ).toBe("reply");
  });
});

describe("extractBouncedEmail", () => {
  test("returns null when nothing parsable", () => {
    expect(extractBouncedEmail("no emails here")).toBeNull();
  });
});
