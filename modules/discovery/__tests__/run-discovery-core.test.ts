// Pure-core tests for the Discovery executor (Phase 2): the idempotency-key
// derivation + the freshness decision the run relies on. The DB-bound
// `runDiscovery` orchestration is integration-tested separately (Postgres MCP)
// — here we lock the deterministic pieces.

import { describe, expect, test, vi } from "vitest";

// run-discovery imports `@/lib/prisma` at module load (lazy Proxy). Stub it so
// importing the module never touches Neon — we only exercise the pure exports.
vi.mock("@/lib/prisma", () => ({ default: {}, Prisma: {} }));

import { cellKey } from "@/lib/cell";
import { decideDiscoveryPlan } from "../freshness-decision";
import { discoveryIdempotencyKey } from "../run-discovery";

const NOW = new Date("2026-06-22T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("discoveryIdempotencyKey", () => {
  test("is stable regardless of cell order", () => {
    const a = discoveryIdempotencyKey(
      [cellKey("medical_spa", "miami"), cellKey("dentist", "austin")],
      "u1",
    );
    const b = discoveryIdempotencyKey(
      [cellKey("dentist", "austin"), cellKey("medical_spa", "miami")],
      "u1",
    );
    expect(a).toBe(b);
  });

  test("differs by requester", () => {
    const keys = [cellKey("medical_spa", "miami")];
    expect(discoveryIdempotencyKey(keys, "u1")).not.toBe(
      discoveryIdempotencyKey(keys, "u2"),
    );
  });

  test("is a 40-char hex digest", () => {
    const k = discoveryIdempotencyKey([cellKey("medical_spa", "miami")], "u1");
    expect(k).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("decideDiscoveryPlan · the gate runDiscovery uses", () => {
  test("a cell discovered within 182d serves from DB; older cells re-fetch — always free", () => {
    const plan = decideDiscoveryPlan(
      [
        {
          cellKey: cellKey("medical_spa", "miami"),
          lastDiscoveredAt: daysAgo(30),
          expectedListings: 100,
        },
        {
          cellKey: cellKey("dentist", "austin"),
          lastDiscoveredAt: daysAgo(200),
          expectedListings: 100,
        },
        {
          cellKey: cellKey("plumber", "dallas"),
          lastDiscoveredAt: null,
          expectedListings: 50,
        },
      ],
      NOW,
    );

    expect(plan.cells[0].outcome).toBe("SERVED_FROM_DB");
    expect(plan.cells[1].outcome).toBe("REFETCH");
    expect(plan.cells[2].outcome).toBe("REFETCH");
    expect(plan.freshCount).toBe(1);
    expect(plan.refetchCount).toBe(2);
    // Discovery is always free to the agency, fresh or refetched alike.
    expect(plan.estimate.freshHitUsd).toBe(0);
    expect(plan.estimate.netUsd).toBe(0);
    expect(plan.estimate.netCredits).toBe(0);
  });
});
