// P5 (2026-07-10) · the Meta reconcile sweep: (A) backfills FINALIZED Apify
// usage onto estimated rows; (B) continues budget-stopped chunked collections.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const db = vi.hoisted(() => {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  let estimatedRows: Array<Record<string, unknown>> = [];
  let pendingRows: Array<Record<string, unknown>> = [];
  let latestByCell = new Map<string, Record<string, unknown>>();
  return {
    updates,
    setEstimated(rows: Array<Record<string, unknown>>) {
      estimatedRows = rows;
    },
    getEstimated: () => estimatedRows,
    setPending(rows: Array<Record<string, unknown>>) {
      pendingRows = rows;
    },
    getPending: () => pendingRows,
    setLatest(map: Map<string, Record<string, unknown>>) {
      latestByCell = map;
    },
    getLatest: (cellKey: string) => latestByCell.get(cellKey) ?? null,
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    adMarketRun: {
      // Route by the JSON-path filter: costEstimated → backfill scan;
      // pendingTargets → continuation scan.
      findMany: vi.fn(
        async (args: {
          where?: { detailJson?: { path?: string[] } };
        }): Promise<Array<Record<string, unknown>>> => {
          const path = args?.where?.detailJson?.path?.[0];
          if (path === "costEstimated") return db.getEstimated();
          if (path === "pendingTargets") return db.getPending();
          return [];
        },
      ),
      findFirst: vi.fn(async (args: { where?: { cellKey?: string } }) =>
        db.getLatest(args?.where?.cellKey ?? ""),
      ),
      // INC-58 · the continuation attempt cap counts a cell's rows in-window.
      // Default 1 (initial attempt only — under the cap); the cap test overrides.
      count: vi.fn(async () => 1),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          db.updates.push({ id: where.id, data });
          return { id: where.id };
        },
      ),
    },
  },
  Prisma: {},
}));

const collector = vi.hoisted(() => ({ runMetaAdsForCell: vi.fn() }));
vi.mock("../meta-ads", () => ({
  runMetaAdsForCell: collector.runMetaAdsForCell,
}));

import { reconcileMetaRuns } from "../meta-reconcile";

const NOW = new Date("2026-07-10T12:00:00.000Z");

function mockFetchUsage(
  usageByRunId: Record<string, number | null>,
  runMeta: { status?: string; finishedAt?: string } = {},
) {
  return vi.fn(async (url: string | URL) => {
    const runId = String(url).split("/").pop() ?? "";
    const usage = usageByRunId[runId];
    return {
      ok: true,
      // INC-58 · usage lives TOP-LEVEL on the run object (data.usageTotalUsd);
      // data.stats.usageTotalUsd never existed on this endpoint.
      json: async () => ({
        data: { usageTotalUsd: usage ?? 0, ...runMeta },
      }),
    } as unknown as Response;
  });
}

beforeEach(() => {
  db.updates.length = 0;
  db.setEstimated([]);
  db.setPending([]);
  db.setLatest(new Map());
  collector.runMetaAdsForCell.mockReset();
  collector.runMetaAdsForCell.mockResolvedValue({
    cellKey: "x",
    outcome: "collected",
  });
  vi.stubEnv("APIFY_TOKEN", "test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("reconcileMetaRuns · A cost backfill", () => {
  test("sums finalized usage across the row's apifyRunIds and clears the flag", async () => {
    db.setEstimated([
      {
        id: "row1",
        detailJson: { costEstimated: true, apifyRunIds: ["r1", "r2"] },
      },
    ]);
    vi.stubGlobal("fetch", mockFetchUsage({ r1: 0.51, r2: 0.32 }));

    const s = await reconcileMetaRuns(NOW);

    expect(s.backfilled).toBe(1);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].id).toBe("row1");
    expect(db.updates[0].data.costUsd).toBeCloseTo(0.83, 6);
    const detail = db.updates[0].data.detailJson as Record<string, unknown>;
    expect(detail.costEstimated).toBe(false);
  });

  test("leaves a row untouched while ANY run's usage isn't finalized yet", async () => {
    db.setEstimated([
      {
        id: "row1",
        detailJson: { costEstimated: true, apifyRunIds: ["r1", "r2"] },
      },
    ]);
    // r2 still reports 0 → not finalized → retry next tick, never guess.
    vi.stubGlobal("fetch", mockFetchUsage({ r1: 0.51, r2: null }));

    const s = await reconcileMetaRuns(NOW);

    expect(s.backfilled).toBe(0);
    expect(db.updates).toHaveLength(0);
  });

  test("a row with no run ids clears its flag so the sweep stops revisiting it", async () => {
    db.setEstimated([
      { id: "row1", detailJson: { costEstimated: true, apifyRunIds: [] } },
    ]);
    vi.stubGlobal("fetch", mockFetchUsage({}));

    const s = await reconcileMetaRuns(NOW);

    expect(s.backfilled).toBe(0);
    expect(db.updates).toHaveLength(1);
    const detail = db.updates[0].data.detailJson as Record<string, unknown>;
    expect(detail.costEstimated).toBe(false);
    expect(detail.reconcileNote).toBe("no-run-ids");
  });
});

describe("reconcileMetaRuns · B chunk continuation", () => {
  test("re-runs the collector with ignoreFreshness for a PARTIAL cell with pending targets", async () => {
    db.setPending([{ cellKey: "dental|kelowna|CA" }]);
    db.setLatest(
      new Map([
        [
          "dental|kelowna|CA",
          { status: "PARTIAL", detailJson: { pendingTargets: 25 } },
        ],
      ]),
    );
    vi.stubGlobal("fetch", mockFetchUsage({}));

    const s = await reconcileMetaRuns(NOW);

    expect(s.continued).toBe(1);
    expect(collector.runMetaAdsForCell).toHaveBeenCalledWith(
      "dental|kelowna|CA",
      NOW,
      { ignoreFreshness: true },
    );
  });

  // INC-58 · THE RUNAWAY REGRESSION. A hard-FAILED 0-progress newest row (a
  // blocked cell) must NEVER be auto-continued — the first shipped version
  // retried the blocked hvac cell every 10 min at ~$0.9/attempt.
  test("never continues a cell whose newest row is FAILED (blocked cell — the runaway)", async () => {
    db.setPending([{ cellKey: "hvac|kelowna|CA" }]);
    db.setLatest(
      new Map([
        [
          "hvac|kelowna|CA",
          { status: "FAILED", detailJson: { pendingTargets: 40 } },
        ],
      ]),
    );
    vi.stubGlobal("fetch", mockFetchUsage({}));

    const s = await reconcileMetaRuns(NOW);

    expect(s.continued).toBe(0);
    expect(collector.runMetaAdsForCell).not.toHaveBeenCalled();
  });

  test("skips a cell whose NEWEST row no longer reports pending targets", async () => {
    db.setPending([{ cellKey: "dental|kelowna|CA" }]);
    db.setLatest(
      new Map([
        [
          "dental|kelowna|CA",
          { status: "PARTIAL", detailJson: { pendingTargets: 0 } },
        ],
      ]),
    );
    vi.stubGlobal("fetch", mockFetchUsage({}));

    const s = await reconcileMetaRuns(NOW);

    expect(s.continued).toBe(0);
    expect(collector.runMetaAdsForCell).not.toHaveBeenCalled();
  });

  test("caps continuations per tick (bounded work)", async () => {
    db.setPending([{ cellKey: "c1" }, { cellKey: "c2" }, { cellKey: "c3" }]);
    db.setLatest(
      new Map([
        ["c1", { status: "PARTIAL", detailJson: { pendingTargets: 5 } }],
        ["c2", { status: "PARTIAL", detailJson: { pendingTargets: 5 } }],
        ["c3", { status: "PARTIAL", detailJson: { pendingTargets: 5 } }],
      ]),
    );
    vi.stubGlobal("fetch", mockFetchUsage({}));

    const s = await reconcileMetaRuns(NOW);

    expect(s.continued).toBe(2); // MAX_CONTINUATIONS
    expect(collector.runMetaAdsForCell).toHaveBeenCalledTimes(2);
  });

  // INC-58 · per-cell attempt cap: past MAX_CELL_ATTEMPTS_IN_WINDOW rows the
  // cell is PARKED (newest pending marker zeroed), never re-attempted.
  test("parks a cell past the per-cell attempt cap instead of continuing", async () => {
    const prisma = (await import("@/lib/prisma")).default;
    db.setPending([{ cellKey: "loop|cell|CA" }]);
    db.setLatest(
      new Map([
        [
          "loop|cell|CA",
          {
            id: "rowX",
            status: "PARTIAL",
            detailJson: { pendingTargets: 5 },
          },
        ],
      ]),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.adMarketRun.count as any).mockResolvedValueOnce(4); // at the cap
    vi.stubGlobal("fetch", mockFetchUsage({}));

    const s = await reconcileMetaRuns(NOW);

    expect(s.continued).toBe(0);
    expect(collector.runMetaAdsForCell).not.toHaveBeenCalled();
    // The newest row's marker was zeroed so the scan stops re-visiting it.
    const park = db.updates.find(
      (u) =>
        (u.data.detailJson as Record<string, unknown>)?.reconcileNote ===
        "attempt-cap-reached",
    );
    expect(park).toBeTruthy();
    expect(
      (park!.data.detailJson as Record<string, unknown>).pendingTargets,
    ).toBe(0);
  });
});

describe("reconcileMetaRuns · $0-terminal grace (INC-58)", () => {
  test("does NOT accept $0 from a run terminal for only 2 minutes", async () => {
    db.setEstimated([
      { id: "row1", detailJson: { costEstimated: true, apifyRunIds: ["r1"] } },
    ]);
    vi.stubGlobal(
      "fetch",
      mockFetchUsage(
        { r1: null },
        {
          status: "TIMED-OUT",
          finishedAt: new Date(NOW.getTime() - 2 * 60_000).toISOString(),
        },
      ),
    );

    const s = await reconcileMetaRuns(NOW);

    expect(s.backfilled).toBe(0);
    expect(db.updates).toHaveLength(0); // wait — usage may finalize late
  });

  test("accepts $0 once the run has been terminal past the grace window", async () => {
    db.setEstimated([
      { id: "row1", detailJson: { costEstimated: true, apifyRunIds: ["r1"] } },
    ]);
    vi.stubGlobal(
      "fetch",
      mockFetchUsage(
        { r1: null },
        {
          status: "TIMED-OUT",
          finishedAt: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
        },
      ),
    );

    const s = await reconcileMetaRuns(NOW);

    expect(s.backfilled).toBe(1);
    expect(db.updates[0].data.costUsd).toBe(0);
  });
});
