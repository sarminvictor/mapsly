// Phase 7 · persistFindings upserts a PlaybookFinding per signal result:
// "flagged" rows carry the verdict fields, "not_checked" rows carry the reason.
// Idempotent via the @@unique([businessId, signalKey]) compound key.

import { beforeEach, describe, expect, test, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  playbookFinding: { upsert: vi.fn().mockResolvedValue({}) },
}));
vi.mock("@/lib/prisma", () => ({
  default: prismaMock,
  Prisma: { JsonNull: "JsonNull" },
}));

import { persistFindings } from "../persist";
import type { PlaybookSignalResult } from "../driver";
import type { CellPlaybook } from "../types";

const PLAYBOOK = {
  id: "med-spa",
  version: "1",
  categorySlugs: ["med-spa"],
  regulations: [],
  signals: [
    {
      key: "ada-web-risk",
      label: "ADA web-accessibility exposure",
      group: "accessibility",
      requiresEnrichments: ["lighthouseAudits"],
      maxConfidence: "high",
      pitchAngle: "Their site fails accessibility checks.",
      regulationRefs: [],
      falsePositiveGuards: [],
      detect: () => null,
    },
    {
      key: "hipaa-pixel-on-phi-page",
      label: "Tracking pixel on patient-data pages",
      group: "privacy",
      requiresEnrichments: ["tech"],
      maxConfidence: "high",
      pitchAngle: "An ad tracker shares a site with intake forms.",
      regulationRefs: [],
      falsePositiveGuards: [],
      detect: () => null,
    },
  ],
} as unknown as CellPlaybook;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("persistFindings", () => {
  test("writes a flagged row with verdict fields", async () => {
    const results: PlaybookSignalResult[] = [
      {
        signalKey: "ada-web-risk",
        verdict: {
          value: "high",
          confidence: "high",
          evidence: [
            {
              kind: "failing_audit",
              label: "Color contrast",
              detail: "12 nodes",
              weight: 1,
            },
          ],
          explanation: "potential ADA exposure",
          corroborationCount: 3,
        },
      },
    ];

    const outcome = await persistFindings("biz_1", results, PLAYBOOK);

    expect(outcome).toEqual({ flagged: 1, notChecked: 0 });
    expect(prismaMock.playbookFinding.upsert).toHaveBeenCalledTimes(1);
    const call = prismaMock.playbookFinding.upsert.mock.calls[0][0];
    // keyed by the compound unique.
    expect(call.where).toEqual({
      businessId_signalKey: { businessId: "biz_1", signalKey: "ada-web-risk" },
    });
    // create + update carry the flagged status + verdict fields + group/pitch
    // pulled from the signal definition.
    expect(call.create).toMatchObject({
      businessId: "biz_1",
      signalKey: "ada-web-risk",
      status: "flagged",
      value: "high",
      confidence: "high",
      corroboration: 3,
      group: "accessibility",
      pitchAngle: "Their site fails accessibility checks.",
      notCheckedReason: null,
    });
    expect(call.update.status).toBe("flagged");
  });

  test("writes a not_checked row with the reason", async () => {
    const results: PlaybookSignalResult[] = [
      {
        signalKey: "hipaa-pixel-on-phi-page",
        verdict: null,
        notCheckedReason: "missing-enrichment:tech",
      },
    ];

    const outcome = await persistFindings("biz_1", results, PLAYBOOK);

    expect(outcome).toEqual({ flagged: 0, notChecked: 1 });
    const call = prismaMock.playbookFinding.upsert.mock.calls[0][0];
    expect(call.create).toMatchObject({
      status: "not_checked",
      notCheckedReason: "missing-enrichment:tech",
      group: "privacy",
      value: "",
    });
    // evidenceJson uses the Prisma JsonNull sentinel for "no JSON".
    expect(call.create.evidenceJson).toBe("JsonNull");
  });

  test("mixes flagged + not_checked across results", async () => {
    const results: PlaybookSignalResult[] = [
      {
        signalKey: "ada-web-risk",
        verdict: {
          value: "medium",
          confidence: "medium",
          evidence: [
            { kind: "failing_audit", label: "Label", detail: "x", weight: 1 },
          ],
          explanation: "x",
          corroborationCount: 2,
        },
      },
      {
        signalKey: "hipaa-pixel-on-phi-page",
        verdict: null,
        notCheckedReason: "guard-tripped:no-website",
      },
    ];

    const outcome = await persistFindings("biz_1", results, PLAYBOOK);
    expect(outcome).toEqual({ flagged: 1, notChecked: 1 });
    expect(prismaMock.playbookFinding.upsert).toHaveBeenCalledTimes(2);
  });
});
