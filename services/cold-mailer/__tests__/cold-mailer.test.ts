import { describe, expect, test } from "vitest";

import {
  isBlockError,
  isHardBounce,
  pickMailbox,
  type MailboxRow,
} from "../index";
import { COLD_RAMP_STEPS, effectiveDailyCap, utcDateKey } from "../ramp";

const day = (n: number): Date => new Date(2026, 5, n, 12, 0, 0); // local noon

describe("effectiveDailyCap", () => {
  test("no ramp start → 0 (mailbox still warming)", () => {
    expect(effectiveDailyCap(30, null, day(10))).toBe(0);
  });

  test("day 0 uses the first ramp step", () => {
    const start = day(10);
    expect(effectiveDailyCap(30, start, start)).toBe(COLD_RAMP_STEPS[0]);
  });

  test("ramps up day by day, capped at target", () => {
    const start = day(1);
    expect(effectiveDailyCap(30, start, day(1))).toBe(3); // day 0
    expect(effectiveDailyCap(30, start, day(3))).toBe(5); // day 2
    expect(effectiveDailyCap(30, start, day(12))).toBe(30); // beyond ramp → target
  });

  test("target dailyCap clamps the ramp step", () => {
    const start = day(1);
    expect(effectiveDailyCap(4, start, day(7))).toBe(4); // step (15) clamped to cap 4
  });
});

describe("utcDateKey", () => {
  test("returns YYYY-MM-DD", () => {
    expect(utcDateKey(new Date("2026-06-09T23:30:00Z"))).toBe("2026-06-09");
  });
});

describe("bounce/block classifiers", () => {
  test("hard bounces detected", () => {
    expect(isHardBounce("550 5.1.1 user unknown", 550)).toBe(true);
    expect(isHardBounce("Recipient address rejected: does not exist")).toBe(
      true,
    );
  });
  test("transient failures are not hard bounces", () => {
    expect(isHardBounce("451 4.7.1 try again later", 451)).toBe(false);
  });
  test("provider blocks detected", () => {
    expect(isBlockError("550 5.4.6 Unusual sending activity")).toBe(true);
    expect(isBlockError("421 too many messages", 421)).toBe(true);
    expect(isBlockError("250 OK")).toBe(false);
  });
});

describe("pickMailbox (sender rotation)", () => {
  const start = day(1);
  const now = day(12); // past the ramp → full dailyCap
  const mbox = (address: string, o: Partial<MailboxRow> = {}): MailboxRow => ({
    address,
    displayName: null,
    dailyCap: 30,
    rampStartedAt: start,
    blockedUntil: null,
    ...o,
  });
  const rows = [mbox("ava"), mbox("leo"), mbox("mia")];

  test("picks the lowest-usage eligible mailbox", () => {
    const sent = new Map([
      ["ava", 5],
      ["leo", 2],
      ["mia", 9],
    ]);
    expect(pickMailbox(rows, sent, new Set(), now)?.address).toBe("leo");
  });

  test("excludes mailboxes already used for the recipient", () => {
    const chosen = pickMailbox(rows, new Map(), new Set(["ava"]), now);
    expect(chosen?.address).not.toBe("ava");
  });

  test("rotates a different sender across three touches", () => {
    const sent = new Map<string, number>();
    const t1 = "ava";
    const t2 = pickMailbox(rows, sent, new Set([t1]), now)?.address;
    expect(t2).toBeDefined();
    expect(t2).not.toBe(t1);
    const t3 = pickMailbox(rows, sent, new Set([t1, t2!]), now)?.address;
    expect(t3).not.toBe(t1);
    expect(t3).not.toBe(t2);
  });

  test("falls back to an eligible mailbox when all are excluded", () => {
    const sent = new Map([
      ["ava", 1],
      ["leo", 4],
      ["mia", 7],
    ]);
    const chosen = pickMailbox(rows, sent, new Set(["ava", "leo", "mia"]), now);
    expect(chosen?.address).toBe("ava"); // lowest usage among all eligible
  });

  test("returns null only when every mailbox is at cap", () => {
    const sent = new Map([
      ["ava", 30],
      ["leo", 30],
      ["mia", 30],
    ]);
    expect(pickMailbox(rows, sent, new Set(), now)).toBeNull();
  });

  test("skips blocked mailboxes", () => {
    const blocked = [mbox("ava", { blockedUntil: day(20) }), mbox("leo")];
    expect(pickMailbox(blocked, new Map(), new Set(), now)?.address).toBe(
      "leo",
    );
  });
});
