// WP3-2 · the enrich-job worker callback authenticates (worker OR cron), Zod-
// validates { jobId }, and processes the job idempotently via claimAndProcessJob.
// A double delivery that loses the atomic claim is a no-op (asserted here at the
// route level; the claim mechanics have their own dispatch.test coverage).

import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock auth helpers + the dispatch processing so we assert ROUTING, not workers.
vi.mock("@/lib/auth/cron-secret", () => ({
  verifyCronAuth: vi.fn(() => ({ ok: false, reason: "unauthorized" })),
}));
vi.mock("@/lib/boxly-worker/client", () => ({
  verifyBoxlyWorkerAuth: vi.fn(() => false),
  enqueueCallbackWebhooks: vi.fn(async () => ({
    taskIds: [],
    queued: 0,
    failed: 0,
  })),
}));
vi.mock("@/lib/url/mapsly-public-url", () => ({
  getMapslyPublicUrl: () => "https://www.mapsly.ai",
}));
vi.mock("@/lib/cost/cost-counter", () => ({
  withCronRun: vi.fn(async (_job: string, fn: () => unknown) => fn()),
}));
vi.mock("@/lib/prisma", () => ({
  default: { enrichmentJob: { findUnique: vi.fn(), findMany: vi.fn() } },
}));
vi.mock("@/modules/enrichment/dispatch", () => ({
  claimAndProcessJob: vi.fn(async () => "done"),
}));
vi.mock("@/modules/enrichment/enrich-worker-dispatch", () => ({
  enrichWorkerAvailable: vi.fn(() => false),
}));

import { POST } from "../route";
import { verifyBoxlyWorkerAuth } from "@/lib/boxly-worker/client";
import prisma from "@/lib/prisma";
import { claimAndProcessJob } from "@/modules/enrichment/dispatch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyMock = (fn: unknown) => fn as any;

function req(body: unknown, auth = "Bearer worker-token"): Request {
  return new Request("https://www.mapsly.ai/api/internal/enrich-job", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: auth },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  anyMock(verifyBoxlyWorkerAuth).mockReturnValue(true); // authorized worker
  p.enrichmentJob.findUnique.mockResolvedValue({
    id: "j1",
    businessId: "b1",
    family: "LIGHTHOUSE",
    runId: "r1",
  });
  anyMock(claimAndProcessJob).mockResolvedValue("done");
});

describe("POST /api/internal/enrich-job (WP3-2)", () => {
  test("401 when neither worker nor cron auth passes", async () => {
    anyMock(verifyBoxlyWorkerAuth).mockReturnValue(false);
    const res = await POST(req({ jobId: "j1" }));
    expect(res.status).toBe(401);
    expect(claimAndProcessJob).not.toHaveBeenCalled();
  });

  test("400 on a bad payload (missing jobId)", async () => {
    const res = await POST(req({ nope: true }));
    expect(res.status).toBe(400);
    expect(claimAndProcessJob).not.toHaveBeenCalled();
  });

  test("processes the job once and returns the outcome", async () => {
    const res = await POST(req({ jobId: "j1" }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { outcome: string };
    expect(json.outcome).toBe("done");
    expect(claimAndProcessJob).toHaveBeenCalledTimes(1);
    expect(claimAndProcessJob).toHaveBeenCalledWith("j1");
  });

  test("a double-delivery whose claim was lost is a no-op outcome", async () => {
    anyMock(claimAndProcessJob).mockResolvedValue("not-claimable");
    const res = await POST(req({ jobId: "j1" }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { outcome: string };
    expect(json.outcome).toBe("not-claimable");
  });
});
