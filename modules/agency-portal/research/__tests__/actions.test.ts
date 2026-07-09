// Research card actions (rename + pin) — the auth + agency-ownership gate is the
// invariant that matters: a member can only mutate their OWN agency's research,
// and every input is Zod-validated. Mocks auth/prisma/revalidateTag.

import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user?: { id?: string } } | null,
  prisma: {
    agencyMember: { findFirst: vi.fn() },
    discovery: { findFirst: vi.fn(), update: vi.fn() },
  },
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.session) }));
vi.mock("@/lib/prisma", () => ({ default: h.prisma }));
vi.mock("next/cache", () => ({ revalidateTag: h.revalidateTag }));

import { renameResearchAction, setResearchPinnedAction } from "../actions";

beforeEach(() => {
  vi.clearAllMocks();
  h.session = { user: { id: "u1" } };
  h.prisma.agencyMember.findFirst.mockResolvedValue({ agencyId: "a1" });
  h.prisma.discovery.findFirst.mockResolvedValue({ agencyId: "a1" });
  h.prisma.discovery.update.mockResolvedValue({ id: "d1" });
});

describe("renameResearchAction", () => {
  test("no session → unauthorized, no write", async () => {
    h.session = null;
    const res = await renameResearchAction({ discoveryId: "d1", name: "X" });
    expect(res).toEqual({ ok: false, error: "unauthorized" });
    expect(h.prisma.discovery.update).not.toHaveBeenCalled();
  });

  test("empty name → invalid_input, no write", async () => {
    const res = await renameResearchAction({ discoveryId: "d1", name: "  " });
    expect(res).toEqual({ ok: false, error: "invalid_input" });
    expect(h.prisma.discovery.update).not.toHaveBeenCalled();
  });

  test("discovery not in the member's agency → forbidden, no write", async () => {
    h.prisma.discovery.findFirst.mockResolvedValue(null); // cross-agency
    const res = await renameResearchAction({ discoveryId: "d1", name: "X" });
    expect(res).toEqual({ ok: false, error: "forbidden" });
    expect(h.prisma.discovery.update).not.toHaveBeenCalled();
  });

  test("owner → updates name + revalidates the research tag", async () => {
    const res = await renameResearchAction({
      discoveryId: "d1",
      name: "  Kelowna hot leads  ",
    });
    expect(res).toEqual({ ok: true });
    expect(h.prisma.discovery.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { name: "Kelowna hot leads" }, // trimmed by Zod
    });
    expect(h.revalidateTag).toHaveBeenCalledWith(
      "agency-a1-research",
      "minutes",
    );
  });
});

describe("setResearchPinnedAction", () => {
  test("no member → forbidden, no write", async () => {
    h.prisma.agencyMember.findFirst.mockResolvedValue(null);
    const res = await setResearchPinnedAction({
      discoveryId: "d1",
      pinned: true,
    });
    expect(res).toEqual({ ok: false, error: "forbidden" });
    expect(h.prisma.discovery.update).not.toHaveBeenCalled();
  });

  test("owner → sets isPinned + revalidates", async () => {
    const res = await setResearchPinnedAction({
      discoveryId: "d1",
      pinned: true,
    });
    expect(res).toEqual({ ok: true });
    expect(h.prisma.discovery.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { isPinned: true },
    });
    expect(h.revalidateTag).toHaveBeenCalledWith(
      "agency-a1-research",
      "minutes",
    );
  });
});
