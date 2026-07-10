// WP3-3 · GET /api/agency/runs/[id]/progress · auth + agency-scope gate, Redis-
// first read with a Prisma fallback, and an ETag/304 on unchanged polls.

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    agencyMember: { findFirst: vi.fn() },
    enrichmentRun: { findFirst: vi.fn() },
  },
}));
vi.mock("@/modules/enrichment/run-progress-counter", () => ({
  readRunProgress: vi.fn(),
}));

import { GET } from "../route";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { readRunProgress } from "@/modules/enrichment/run-progress-counter";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyMock = (fn: unknown) => fn as any;

function get(runId: string, ifNoneMatch?: string): Request {
  return new Request(
    `https://www.mapsly.ai/api/agency/runs/${runId}/progress`,
    { headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : {} },
  );
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  anyMock(auth).mockResolvedValue({ user: { id: "u1" } });
  p.agencyMember.findFirst.mockResolvedValue({ agencyId: "ag1" });
  p.enrichmentRun.findFirst.mockResolvedValue({
    status: "RUNNING",
    unitsRequested: 50,
    unitsCompleted: 10,
    startedAt: new Date("2026-07-10T12:00:00.000Z"),
  });
});

describe("GET run progress (WP3-3)", () => {
  test("401 when unauthenticated", async () => {
    anyMock(auth).mockResolvedValue(null);
    const res = await GET(get("r1"), params("r1"));
    expect(res.status).toBe(401);
  });

  test("404 when the run is not in the caller's agency (no cross-agency leak)", async () => {
    p.enrichmentRun.findFirst.mockResolvedValue(null); // scoped query returns nothing
    const res = await GET(get("rX"), params("rX"));
    expect(res.status).toBe(404);
  });

  test("returns the Redis counters + an ETag", async () => {
    anyMock(readRunProgress).mockResolvedValue({
      done: 42,
      failed: 3,
      total: 50,
      status: "RUNNING",
      retrying: 1,
    });
    const res = await GET(get("r1"), params("r1"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      done: number;
      total: number;
      failed: number;
      retrying: number;
      status: string;
    };
    expect(json).toEqual({
      done: 42,
      total: 50,
      failed: 3,
      retrying: 1,
      status: "RUNNING",
      // ETA anchor — always present (constant per run, not in the ETag).
      startedAt: "2026-07-10T12:00:00.000Z",
    });
    expect(res.headers.get("etag")).toBeTruthy();
  });

  test("DB terminal status is authoritative over a stale Redis RUNNING (masking fix)", async () => {
    // 2026-07-10 · if the close-time terminal re-seed to Redis was lost, Redis
    // keeps a stale RUNNING; the DB row is the truth. The payload must report the
    // DB's terminal status so the client stops spinning.
    p.enrichmentRun.findFirst.mockResolvedValue({
      status: "OK",
      unitsRequested: 50,
      unitsCompleted: 50,
      creditsHeld: 10,
      creditsCharged: 8,
      startedAt: new Date("2026-07-10T12:00:00.000Z"),
      enrichmentsJson: ["contacts"],
    });
    anyMock(readRunProgress).mockResolvedValue({
      done: 50,
      failed: 0,
      total: 50,
      retrying: 0,
      status: "RUNNING", // stale — the close re-seed was lost
    });
    const res = await GET(get("r1"), params("r1"));
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("OK"); // DB truth wins, not the stale Redis RUNNING
  });

  test("a legacy Redis payload with no `retrying` serializes retrying:0, never null", async () => {
    // Hardening for INC-60: a counter written before the retrying key existed
    // must coerce to 0 (never NaN → null in the JSON).
    anyMock(readRunProgress).mockResolvedValue({
      done: 5,
      failed: 0,
      total: 10,
      status: "RUNNING",
    } as never);
    const res = await GET(get("r1"), params("r1"));
    const json = (await res.json()) as { retrying: number };
    expect(json.retrying).toBe(0);
  });

  test("falls back to the DB counters on a Redis miss", async () => {
    anyMock(readRunProgress).mockResolvedValue(null); // Redis miss
    const res = await GET(get("r1"), params("r1"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { done: number; total: number };
    expect(json.done).toBe(10); // unitsCompleted
    expect(json.total).toBe(50); // unitsRequested
  });

  // WP4-3 · the per-job INCR bumps once per FAMILY row for within-tick liveness,
  // so a multi-family run's raw counters can momentarily exceed the BUSINESS
  // total between the per-tick business-level re-seeds. The endpoint clamps to
  // the business unit so the client never sees done>total (>100%) or a
  // done+failed sum past N.
  test("clamps raw counters to the business total (never >100%)", async () => {
    anyMock(readRunProgress).mockResolvedValue({
      done: 140, // 3 families × ~47 businesses bumped per-row
      failed: 12,
      total: 50, // 50 businesses requested
      status: "RUNNING",
    });
    const res = await GET(get("r1"), params("r1"));
    const json = (await res.json()) as {
      done: number;
      total: number;
      failed: number;
    };
    expect(json.total).toBe(50);
    expect(json.failed).toBe(12);
    expect(json.done).toBe(38); // clamped to total − failed
    expect(json.done + json.failed).toBeLessThanOrEqual(json.total);
  });

  test("304 when the ETag matches (unchanged poll)", async () => {
    anyMock(readRunProgress).mockResolvedValue({
      done: 42,
      failed: 3,
      total: 50,
      status: "RUNNING",
    });
    const first = await GET(get("r1"), params("r1"));
    const etag = first.headers.get("etag")!;
    const second = await GET(get("r1", etag), params("r1"));
    expect(second.status).toBe(304);
  });

  // WB-COL-2 · the terminal payload carries the run's purchased enrichment
  // tokens (sanitized enrichmentsJson) so the workbench can auto-show the
  // bought data's columns even after a reload-mid-run.
  test("terminal payload includes the sanitized enrichments", async () => {
    p.enrichmentRun.findFirst.mockResolvedValue({
      status: "OK",
      unitsRequested: 50,
      unitsCompleted: 50,
      creditsHeld: 10,
      creditsCharged: 8,
      startedAt: new Date("2026-07-10T12:00:00.000Z"),
      // Non-string junk must be filtered, never crash the payload.
      enrichmentsJson: ["meta_ads", 42, "reviews", null, "lighthouse"],
    });
    anyMock(readRunProgress).mockResolvedValue({
      done: 50,
      failed: 0,
      total: 50,
      status: "OK",
    });
    const res = await GET(get("r1"), params("r1"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      enrichments?: string[];
      creditsCharged?: number;
    };
    expect(json.enrichments).toEqual(["meta_ads", "reviews", "lighthouse"]);
    expect(json.creditsCharged).toBe(8); // the receipt still rides terminal
  });

  test("non-terminal payload omits enrichments", async () => {
    anyMock(readRunProgress).mockResolvedValue({
      done: 10,
      failed: 0,
      total: 50,
      status: "RUNNING",
    });
    const res = await GET(get("r1"), params("r1"));
    const json = (await res.json()) as { enrichments?: string[] };
    expect(json.enrichments).toBeUndefined();
  });

  test("malformed enrichmentsJson → [] (never trusted shape)", async () => {
    p.enrichmentRun.findFirst.mockResolvedValue({
      status: "FAILED",
      unitsRequested: 50,
      unitsCompleted: 0,
      creditsHeld: 10,
      creditsCharged: 0,
      startedAt: new Date("2026-07-10T12:00:00.000Z"),
      enrichmentsJson: { not: "an-array" },
    });
    anyMock(readRunProgress).mockResolvedValue(null); // DB fallback path
    const res = await GET(get("r1"), params("r1"));
    const json = (await res.json()) as { enrichments?: string[] };
    expect(json.enrichments).toEqual([]);
  });
});
