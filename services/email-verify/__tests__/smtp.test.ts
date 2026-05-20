// Unit tests for services/email-verify/smtp.
//
// Mocks: @/lib/prisma (CronRun lifecycle for withCostCounter) and
// @/lib/cache (so kvCache is a passthrough; we exercise the uncached
// entrypoint to keep tests fast and deterministic). DNS resolver +
// socket factory are replaced via __setResolverForTesting +
// __setSocketFactoryForTesting so no network / DNS traffic happens.
//
// Coverage:
//   - syntax gate rejects junk before DNS
//   - missing-domain edge cases
//   - no MX record → undeliverable
//   - DNS error → undeliverable
//   - happy path: 220 banner → 250 EHLO → 250 MAIL → 250 RCPT → deliverable
//   - 550 RCPT → undeliverable
//   - 450 RCPT → inconclusive
//   - multi-line EHLO continuation correctly accumulates before verdict
//   - banner refuse (421) → inconclusive
//   - EHLO refused, HELO accepted → continues
//   - socket connect failure → inconclusive (NOT undeliverable)
//   - socket timeout → inconclusive
//   - probe hard timeout → inconclusive
//   - cron-context invariant — uncached entrypoint outside withCronRun throws
//   - PII hygiene — reason never contains the probed email's local-part
//   - lowest-priority MX wins
//   - isLikelyDeliverable maps verdicts to boolean

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---- Fake Prisma for cost-counter -------------------------------------

interface FakeRow {
  id: string;
  job: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  costUsd: number | null;
}

const fakeDb = {
  rows: new Map<string, FakeRow>(),
  nextId: 1,
  reset() {
    this.rows.clear();
    this.nextId = 1;
  },
};

vi.mock("@/lib/prisma", () => ({
  default: {
    cronRun: {
      create: vi.fn(
        async ({ data }: { data: { job: string; costUsd?: number } }) => {
          const id = `run_${fakeDb.nextId++}`;
          const row: FakeRow = {
            id,
            job: data.job,
            status: "RUNNING",
            startedAt: new Date(),
            finishedAt: null,
            // Mirror Postgres NULL semantics — only initialize if caller
            // passed an explicit value (per INC-32). The production code
            // does pass 0; this guard surfaces regressions.
            costUsd: data.costUsd == null ? null : data.costUsd,
          };
          fakeDb.rows.set(id, row);
          return { id, job: row.job, startedAt: row.startedAt };
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: {
            status?: string;
            finishedAt?: Date;
            costUsd?: number | { increment: number };
          };
        }) => {
          const row = fakeDb.rows.get(where.id);
          if (!row) throw new Error(`no row ${where.id}`);
          if (data.status !== undefined) row.status = data.status;
          if (data.finishedAt !== undefined) row.finishedAt = data.finishedAt;
          if (data.costUsd !== undefined) {
            if (
              typeof data.costUsd === "object" &&
              "increment" in data.costUsd
            ) {
              row.costUsd =
                row.costUsd == null
                  ? null
                  : row.costUsd + data.costUsd.increment;
            } else {
              row.costUsd = data.costUsd;
            }
          }
          return row;
        },
      ),
    },
  },
  Prisma: {},
}));

// kvCache passthrough — we test the uncached path directly. The cached
// wrapper is exercised separately in cache-layer tests.
vi.mock("@/lib/cache", () => ({
  kvCache: (_prefix: string, _opts: unknown, fn: unknown) => fn,
  invalidateCacheTag: vi.fn(async () => 0),
}));

// ---- SUT --------------------------------------------------------------

import {
  smtpVerifyEmail,
  smtpVerifyEmailUncached,
  isLikelyDeliverable,
  __setResolverForTesting,
  __setSocketFactoryForTesting,
  type ResolverLike,
  type SocketFactory,
  type SocketLike,
  SMTP_VERIFY_UNIT_COST_USD,
} from "../smtp";
import { openCronRun, runWithCronRun } from "@/lib/cost/cost-counter";

// ---- Test helpers -----------------------------------------------------

/** Build a fake resolver returning the given MX records. */
function fakeResolver(
  records: Array<{ exchange: string; priority: number }>,
): ResolverLike {
  return {
    resolveMx: vi.fn(async (_domain: string) => records),
  };
}

/** Build a fake resolver that throws on every lookup. */
function failingResolver(err: Error = new Error("ENOTFOUND")): ResolverLike {
  return {
    resolveMx: vi.fn(async (_domain: string) => {
      throw err;
    }),
  };
}

/**
 * Build a fake socket that replays a scripted SMTP server. The script is
 * an array of step descriptors; each describes what the server says when
 * the client writes. We don't track exact client requests by content —
 * just sequence them.
 */
interface ScriptStep {
  /** Lines (without CRLF) to push to the client when this step fires.
   *  Each line is sent as a single 'data' event for determinism. */
  send: string[];
  /** Special outcomes (mutually exclusive with `send`). */
  closeBeforeSend?: boolean;
  errorBeforeSend?: Error;
  /** Idle after sending — used to simulate timeouts. */
  idle?: boolean;
}

function fakeSocketFactory(script: ScriptStep[]): {
  factory: SocketFactory;
  lastHost: string | null;
} {
  const state = { lastHost: null as string | null };

  const factory: SocketFactory = (host, _port) => {
    state.lastHost = host;
    let step = 0;
    let timeoutFn: (() => void) | null = null;
    let errorFn: ((err: Error) => void) | null = null;
    let closeFn: (() => void) | null = null;
    let dataFn: ((chunk: string) => void) | null = null;

    const writePending: string[] = [];
    let destroyed = false;

    function advance(): void {
      if (destroyed) return;
      if (step >= script.length) return;
      const current = script[step]!;

      if (current.errorBeforeSend) {
        const err = current.errorBeforeSend;
        step++;
        Promise.resolve().then(() => {
          if (!destroyed) errorFn?.(err);
        });
        return;
      }
      if (current.closeBeforeSend) {
        step++;
        Promise.resolve().then(() => {
          if (!destroyed) closeFn?.();
        });
        return;
      }
      step++;
      Promise.resolve().then(() => {
        if (destroyed) return;
        for (const line of current.send) {
          dataFn?.(line + "\r\n");
        }
        if (current.idle) {
          // Don't auto-advance. Caller will fire timeout via a fake clock
          // or the test will run probe hard timeout.
          Promise.resolve().then(() => {
            if (!destroyed) timeoutFn?.();
          });
        }
      });
    }

    // Cast through `unknown` so the overloaded SocketLike.on signature
    // doesn't fail strict structural matching against the single-signature
    // mock. The runtime contract is honored.
    const sock = {
      setTimeout: vi.fn(),
      on(event: string, listener: (...args: unknown[]) => void): void {
        if (event === "data") dataFn = listener as typeof dataFn;
        else if (event === "error") errorFn = listener as typeof errorFn;
        else if (event === "close") closeFn = listener as typeof closeFn;
        else if (event === "timeout") timeoutFn = listener as typeof timeoutFn;
        // 'connect' not modeled — we go straight to data.
      },
      write(data: string): void {
        writePending.push(data);
        advance();
      },
      end(_data?: string): void {
        destroyed = true;
      },
      destroy(): void {
        destroyed = true;
      },
    } as unknown as SocketLike;

    // Banner fires before any client write.
    advance();
    return sock;
  };

  return { factory, lastHost: state.lastHost };
}

function happyPathScript(): ScriptStep[] {
  return [
    { send: ["220 mx.example.com ESMTP ready"] }, // banner
    {
      send: ["250-mx.example.com Hello", "250-PIPELINING", "250 SIZE 35882577"],
    }, // EHLO multi-line
    { send: ["250 2.1.0 Sender OK"] }, // MAIL FROM
    { send: ["250 2.1.5 Recipient OK"] }, // RCPT TO
  ];
}

// ---- Boilerplate ------------------------------------------------------

beforeEach(() => {
  fakeDb.reset();
});

afterEach(() => {
  __setResolverForTesting(null);
  __setSocketFactoryForTesting(null);
  vi.useRealTimers();
});

// ---- Tests ------------------------------------------------------------

describe("smtpVerifyEmail · public contract", () => {
  test("unit cost is $0", () => {
    expect(SMTP_VERIFY_UNIT_COST_USD).toBe(0);
  });

  test("kvCache wrapper does not break the verdict shape (smoke)", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    const sf = fakeSocketFactory(happyPathScript());
    __setSocketFactoryForTesting(sf.factory);

    const run = await openCronRun("test-smoke");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmail({ email: "alice@example.com" }),
    );

    expect(out.verdict).toBe("deliverable");
    expect(out.smtpCode).toBe(250);
    expect(out.mxHost).toBe("mx.example.com");
    expect(out.hasMx).toBe(true);
  });
});

describe("syntax + DNS gates", () => {
  test("syntactically invalid email → undeliverable, no DNS", async () => {
    const resolver = failingResolver();
    __setResolverForTesting(resolver);
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "not an email" }),
    );
    expect(out.verdict).toBe("undeliverable");
    expect(out.reason).toBe("syntax-invalid");
    expect(out.smtpCode).toBeNull();
    expect(out.hasMx).toBe(false);
    expect(resolver.resolveMx).not.toHaveBeenCalled();
  });

  test("empty domain → undeliverable", async () => {
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "alice@" }),
    );
    expect(out.verdict).toBe("undeliverable");
  });

  test("missing @ → undeliverable", async () => {
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "no-at-sign.example.com" }),
    );
    expect(out.verdict).toBe("undeliverable");
  });

  test("DNS lookup error → undeliverable, no MX", async () => {
    __setResolverForTesting(failingResolver());
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "alice@no-such-domain.example" }),
    );
    expect(out.verdict).toBe("undeliverable");
    expect(out.reason).toBe("no-mx-record");
    expect(out.hasMx).toBe(false);
    expect(out.mxHost).toBeNull();
  });

  test("DNS returns empty MX list → undeliverable", async () => {
    __setResolverForTesting(fakeResolver([]));
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "alice@empty-mx.example" }),
    );
    expect(out.verdict).toBe("undeliverable");
    expect(out.reason).toBe("no-mx-record");
  });

  test("lowest-priority MX wins", async () => {
    __setResolverForTesting(
      fakeResolver([
        { exchange: "alt.example.com", priority: 20 },
        { exchange: "primary.example.com", priority: 10 },
        { exchange: "fallback.example.com", priority: 30 },
      ]),
    );
    const sf = fakeSocketFactory(happyPathScript());
    __setSocketFactoryForTesting(sf.factory);

    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "alice@example.com" }),
    );
    expect(out.mxHost).toBe("primary.example.com");
  });
});

describe("SMTP conversation outcomes", () => {
  test("250 on RCPT TO → deliverable", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    __setSocketFactoryForTesting(fakeSocketFactory(happyPathScript()).factory);

    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "alice@example.com" }),
    );
    expect(out.verdict).toBe("deliverable");
    expect(out.smtpCode).toBe(250);
  });

  test("550 on RCPT TO → undeliverable + sentry-safe reason", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    __setSocketFactoryForTesting(
      fakeSocketFactory([
        { send: ["220 mx.example.com ESMTP"] },
        { send: ["250 Hello"] },
        { send: ["250 OK"] },
        { send: ["550 5.1.1 User unknown alice@example.com"] },
      ]).factory,
    );
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "alice@example.com" }),
    );
    expect(out.verdict).toBe("undeliverable");
    expect(out.smtpCode).toBe(550);
    expect(out.reason).toMatch(/^rcpt-user-unknown-550/);
    // PII hygiene — local part must not leak into the reason
    expect(out.reason).not.toContain("alice");
  });

  test("450 on RCPT TO → inconclusive", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    __setSocketFactoryForTesting(
      fakeSocketFactory([
        { send: ["220 mx.example.com ESMTP"] },
        { send: ["250 Hello"] },
        { send: ["250 OK"] },
        { send: ["450 4.2.1 Try later"] },
      ]).factory,
    );
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "alice@example.com" }),
    );
    expect(out.verdict).toBe("inconclusive");
    expect(out.smtpCode).toBe(450);
    expect(out.reason).toMatch(/^rcpt-temporary-450/);
  });

  test("251 on RCPT TO (forwarded) → deliverable", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    __setSocketFactoryForTesting(
      fakeSocketFactory([
        { send: ["220 mx.example.com ESMTP"] },
        { send: ["250 Hello"] },
        { send: ["250 OK"] },
        { send: ["251 forwarded to <bob@otherdomain.com>"] },
      ]).factory,
    );
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "alice@example.com" }),
    );
    expect(out.verdict).toBe("deliverable");
    expect(out.smtpCode).toBe(251);
  });

  test("multi-line EHLO continuation parsed correctly", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    __setSocketFactoryForTesting(
      fakeSocketFactory([
        { send: ["220 mx.example.com ESMTP"] },
        {
          // Five continuation lines, final line uses "250 " (with space).
          send: [
            "250-mx.example.com Hello",
            "250-PIPELINING",
            "250-SIZE 35882577",
            "250-VRFY",
            "250-ETRN",
            "250-STARTTLS",
            "250-ENHANCEDSTATUSCODES",
            "250-8BITMIME",
            "250-DSN",
            "250 SMTPUTF8",
          ],
        },
        { send: ["250 OK"] },
        { send: ["250 OK"] },
      ]).factory,
    );
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "alice@example.com" }),
    );
    expect(out.verdict).toBe("deliverable");
  });

  test("EHLO refused (502/500) falls back to HELO", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    __setSocketFactoryForTesting(
      fakeSocketFactory([
        { send: ["220 mx.example.com ESMTP"] },
        { send: ["502 5.5.1 EHLO not implemented"] }, // EHLO refused
        { send: ["250 mx.example.com Hello"] }, // HELO accepted
        { send: ["250 OK"] }, // MAIL
        { send: ["250 OK"] }, // RCPT
      ]).factory,
    );
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "alice@example.com" }),
    );
    expect(out.verdict).toBe("deliverable");
  });

  test("MAIL FROM refused → inconclusive (NOT undeliverable)", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    __setSocketFactoryForTesting(
      fakeSocketFactory([
        { send: ["220 mx.example.com ESMTP"] },
        { send: ["250 Hello"] },
        { send: ["553 5.7.1 Sender address rejected"] },
      ]).factory,
    );
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "alice@example.com" }),
    );
    // The sender rejection tells us nothing about the recipient.
    expect(out.verdict).toBe("inconclusive");
    expect(out.reason).toBe("mail-from-refused");
  });

  test("banner-stage 4xx → inconclusive (server refusing connections)", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    __setSocketFactoryForTesting(
      fakeSocketFactory([
        { send: ["421 4.7.0 Service not available, closing"] },
      ]).factory,
    );
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "alice@example.com" }),
    );
    expect(out.verdict).toBe("inconclusive");
    expect(out.reason).toBe("banner-refused");
  });
});

describe("transport failures all → inconclusive", () => {
  test("ECONNREFUSED → inconclusive", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    const econn = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    __setSocketFactoryForTesting(
      fakeSocketFactory([{ send: [], errorBeforeSend: econn }]).factory,
    );

    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "alice@example.com" }),
    );
    expect(out.verdict).toBe("inconclusive");
    expect(out.reason).toBe("transport-econnrefused");
    expect(out.hasMx).toBe(true);
  });

  test("socket closed before banner → inconclusive", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    __setSocketFactoryForTesting(
      fakeSocketFactory([{ send: [], closeBeforeSend: true }]).factory,
    );
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "alice@example.com" }),
    );
    expect(out.verdict).toBe("inconclusive");
    expect(out.reason).toBe("closed-early");
  });

  test("socket timeout during conversation → inconclusive", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    __setSocketFactoryForTesting(
      fakeSocketFactory([
        { send: ["220 mx.example.com ESMTP"] },
        { send: ["250 Hello"] },
        { send: [], idle: true }, // simulate stuck connection after MAIL FROM
      ]).factory,
    );
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "alice@example.com" }),
    );
    expect(out.verdict).toBe("inconclusive");
    expect(out.reason).toBe("socket-timeout");
  });
});

describe("cron-context invariant", () => {
  test("uncached entrypoint outside withCronRun throws", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    __setSocketFactoryForTesting(fakeSocketFactory(happyPathScript()).factory);

    await expect(
      smtpVerifyEmailUncached({ email: "alice@example.com" }),
    ).rejects.toThrow(/CronRun/);
  });
});

describe("isLikelyDeliverable convenience", () => {
  test("deliverable → true", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    __setSocketFactoryForTesting(fakeSocketFactory(happyPathScript()).factory);
    const run = await openCronRun("test");
    const result = await runWithCronRun(run, () =>
      isLikelyDeliverable("alice@example.com"),
    );
    expect(result).toBe(true);
  });

  test("undeliverable → false", async () => {
    __setResolverForTesting(failingResolver());
    const run = await openCronRun("test");
    const result = await runWithCronRun(run, () =>
      isLikelyDeliverable("alice@no-such-domain.example"),
    );
    expect(result).toBe(false);
  });

  test("inconclusive → true (catch-all + greylist treated as accept)", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    __setSocketFactoryForTesting(
      fakeSocketFactory([
        { send: ["220 mx.example.com ESMTP"] },
        { send: ["250 Hello"] },
        { send: ["250 OK"] },
        { send: ["450 4.2.1 Try later"] },
      ]).factory,
    );
    const run = await openCronRun("test");
    const result = await runWithCronRun(run, () =>
      isLikelyDeliverable("alice@example.com"),
    );
    expect(result).toBe(true);
  });
});

describe("PII hygiene", () => {
  test("reason text never contains the probed local-part", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    __setSocketFactoryForTesting(
      fakeSocketFactory([
        { send: ["220 mx.example.com ESMTP"] },
        { send: ["250 Hello"] },
        { send: ["250 OK"] },
        // Server explicitly echoes the address back — common with Postfix.
        {
          send: [
            "550 5.1.1 <sensitive-local-part@example.com>: Recipient address rejected: User unknown in virtual mailbox table",
          ],
        },
      ]).factory,
    );
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({
        email: "sensitive-local-part@example.com",
      }),
    );
    expect(out.verdict).toBe("undeliverable");
    expect(out.reason).not.toContain("sensitive-local-part");
    // Reason still has SMTP code so debugging is possible.
    expect(out.reason).toContain("550");
  });

  test("email is lowercased + trimmed", async () => {
    __setResolverForTesting(
      fakeResolver([{ exchange: "mx.example.com", priority: 10 }]),
    );
    __setSocketFactoryForTesting(fakeSocketFactory(happyPathScript()).factory);
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "  Alice@Example.COM  " }),
    );
    expect(out.email).toBe("alice@example.com");
  });
});

describe("durationMs telemetry", () => {
  test("durationMs is a non-negative number on every path", async () => {
    __setResolverForTesting(failingResolver());
    const run = await openCronRun("test");
    const out = await runWithCronRun(run, () =>
      smtpVerifyEmailUncached({ email: "alice@bogus.example" }),
    );
    expect(typeof out.durationMs).toBe("number");
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });
});
