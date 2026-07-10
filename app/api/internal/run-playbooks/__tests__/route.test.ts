// The playbooks close-sweep authenticates via EITHER the Boxly worker token OR
// CRON_SECRET (2026-07-10 dual-auth fix). Before it, the route accepted ONLY
// CRON_SECRET, so the worker's CallbackWebhookProcessor POST (which carries
// BOXLY_WORKER_AUTH_TOKEN) 401'd and the sweep was dead — 55 findings stuck
// missing-enrichment though their data existed. These assert the ROUTING gate,
// not the playbook engine (mocked).

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/auth/cron-secret", () => ({
  verifyCronAuth: vi.fn(() => ({ ok: false, reason: "unauthorized" })),
}));
vi.mock("@/lib/boxly-worker/client", () => ({
  verifyBoxlyWorkerAuth: vi.fn(() => false),
}));
vi.mock("@/lib/cost/cost-counter", () => ({
  withCronRun: vi.fn(async (_job: string, fn: () => unknown) => fn()),
}));
vi.mock("@/lib/prisma", () => ({
  default: { business: { findMany: vi.fn(async () => []) } },
}));
vi.mock("@/modules/playbooks/registry", () => ({
  ALL_PLAYBOOKS: [{ categorySlugs: ["dental_clinic"] }],
}));
vi.mock("@/modules/playbooks/run", () => ({
  runPlaybooksForBusiness: vi.fn(async () => ({ playbookId: null })),
}));

import { POST } from "../route";
import { verifyCronAuth } from "@/lib/auth/cron-secret";
import { verifyBoxlyWorkerAuth } from "@/lib/boxly-worker/client";
import { runPlaybooksForBusiness } from "@/modules/playbooks/run";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyMock = (fn: unknown) => fn as any;

function req(body: unknown = {}, auth = "Bearer worker-token"): Request {
  const payload = JSON.stringify(body);
  return new Request("https://www.mapsly.ai/api/internal/run-playbooks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // The route only parses the body when content-length is present; undici's
      // Request in vitest doesn't auto-populate it, so set it explicitly.
      "content-length": String(new TextEncoder().encode(payload).length),
      authorization: auth,
    },
    body: payload,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  anyMock(verifyCronAuth).mockReturnValue({ ok: false });
  anyMock(verifyBoxlyWorkerAuth).mockReturnValue(false);
});

describe("POST /api/internal/run-playbooks · dual-auth", () => {
  test("401 when neither worker nor cron auth passes", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(runPlaybooksForBusiness).not.toHaveBeenCalled();
  });

  test("200 for the Boxly worker token (the regression: was 401)", async () => {
    anyMock(verifyBoxlyWorkerAuth).mockReturnValue(true);
    const res = await POST(req({ businessIds: ["b1"] }));
    expect(res.status).toBe(200);
    expect(runPlaybooksForBusiness).toHaveBeenCalledWith("b1");
  });

  test("200 for CRON_SECRET (the cron caller path still works)", async () => {
    anyMock(verifyCronAuth).mockReturnValue({ ok: true });
    const res = await POST(req({ businessIds: ["b2"] }));
    expect(res.status).toBe(200);
    expect(runPlaybooksForBusiness).toHaveBeenCalledWith("b2");
  });
});
