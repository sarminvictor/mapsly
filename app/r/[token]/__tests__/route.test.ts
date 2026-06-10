/**
 * Tests · /r/[token] landing-page removal (improvement plan #3).
 *
 * The load-bearing invariant is SCANNER SAFETY: email security scanners
 * prefetch GET links, so GET must NEVER write — only the POSTed confirm
 * button deactivates the landing + suppresses the email.
 *
 * Also covered: Zod token validation (400), unknown token (404), the POST
 * write set (LandingPage.isActive=false · ColdSuppression upsert ·
 * ColdRecipient stop), and the no-email branch.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

const { findUniqueMock, updateMock, updateManyMock, suppressMock } = vi.hoisted(
  () => ({
    findUniqueMock: vi.fn(),
    updateMock: vi.fn(),
    updateManyMock: vi.fn(),
    suppressMock: vi.fn(),
  }),
);

vi.mock("@/lib/prisma", () => ({
  default: {
    landingPage: { findUnique: findUniqueMock, update: updateMock },
    coldRecipient: { updateMany: updateManyMock },
  },
}));

vi.mock("@/modules/cold/suppression", () => ({ suppress: suppressMock }));

// Rate limiting is fail-soft without KV anyway; mock it out so tests stay
// deterministic and log-free.
vi.mock("@/lib/middleware/rate-limit", () => ({
  PUBLIC_LIMIT: { name: "public", limit: 60, window: "1 m", prefix: "rl:p" },
  ipKey: () => "test-ip",
  rateLimit: vi.fn(async () => null),
}));

import { GET, POST } from "../route";

const TOKEN = "4820731965540827";

const ACTIVE_LANDING = {
  id: "lp_1",
  isActive: true,
  business: { name: "Solea Brickell Spa", email: "Owner@Spa.com" },
};

function ctx(token: string) {
  return { params: Promise.resolve({ token }) };
}

function req(method: "GET" | "POST", token: string): Request {
  return new Request(`https://mapsly.ai/r/${token}`, { method });
}

function expectNoWrites() {
  expect(updateMock).not.toHaveBeenCalled();
  expect(suppressMock).not.toHaveBeenCalled();
  expect(updateManyMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  findUniqueMock.mockReset();
  updateMock.mockReset();
  updateManyMock.mockReset();
  suppressMock.mockReset();
  updateMock.mockResolvedValue({ id: "lp_1" });
  updateManyMock.mockResolvedValue({ count: 1 });
  suppressMock.mockResolvedValue(undefined);
});

describe("GET /r/[token] · scanner safety", () => {
  test("valid token → confirm page with POST button, NO writes", async () => {
    findUniqueMock.mockResolvedValueOnce(ACTIVE_LANDING);
    const res = await GET(req("GET", TOKEN), ctx(TOKEN));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Remove this page?");
    expect(body).toContain(`<form method="post" action="/r/${TOKEN}"`);
    expect(body).toContain("Solea Brickell Spa");
    expectNoWrites();
  });

  test("malformed token → 400, no lookup, no writes", async () => {
    const res = await GET(req("GET", "not-a-token"), ctx("not-a-token"));
    expect(res.status).toBe(400);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expectNoWrites();
  });

  test("unknown token → 404, no writes", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    const res = await GET(req("GET", TOKEN), ctx(TOKEN));
    expect(res.status).toBe(404);
    expectNoWrites();
  });

  test("already-inactive landing → done page, no writes (idempotent)", async () => {
    findUniqueMock.mockResolvedValueOnce({
      ...ACTIVE_LANDING,
      isActive: false,
    });
    const res = await GET(req("GET", TOKEN), ctx(TOKEN));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(
      "This page is no longer available and we won't email you.",
    );
    expectNoWrites();
  });

  test("business name is HTML-escaped on the confirm page", async () => {
    findUniqueMock.mockResolvedValueOnce({
      ...ACTIVE_LANDING,
      business: { name: '<script>alert("x")</script>', email: null },
    });
    const res = await GET(req("GET", TOKEN), ctx(TOKEN));
    const body = await res.text();
    expect(body).not.toContain("<script>alert");
    expect(body).toContain("&lt;script&gt;");
  });
});

describe("POST /r/[token] · executes the removal", () => {
  test("deactivates the landing + suppresses the email + stops recipients", async () => {
    findUniqueMock.mockResolvedValueOnce(ACTIVE_LANDING);
    const res = await POST(req("POST", TOKEN), ctx(TOKEN));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(
      "This page is no longer available and we won't email you.",
    );

    expect(updateMock).toHaveBeenCalledWith({
      where: { token: TOKEN },
      data: { isActive: false },
    });
    expect(suppressMock).toHaveBeenCalledWith(
      "owner@spa.com",
      "UNSUBSCRIBE",
      "landing-removal",
    );
    // reportToken stores the full "slug-token" landing param (enroll.ts), so
    // the stop must match the "-token" suffix, not just the bare token.
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { email: "owner@spa.com" },
          { reportToken: TOKEN },
          { reportToken: { endsWith: `-${TOKEN}` } },
        ],
      },
      data: {
        status: "UNSUBSCRIBED",
        stopReason: "landing-removed",
        nextRunAt: null,
      },
    });
  });

  test("no business email → still deactivates, suppression skipped", async () => {
    findUniqueMock.mockResolvedValueOnce({
      ...ACTIVE_LANDING,
      business: { name: "No Email Biz", email: null },
    });
    const res = await POST(req("POST", TOKEN), ctx(TOKEN));
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({
      where: { token: TOKEN },
      data: { isActive: false },
    });
    expect(suppressMock).not.toHaveBeenCalled();
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { reportToken: TOKEN },
          { reportToken: { endsWith: `-${TOKEN}` } },
        ],
      },
      data: {
        status: "UNSUBSCRIBED",
        stopReason: "landing-removed",
        nextRunAt: null,
      },
    });
  });

  test("malformed token → 400, no writes", async () => {
    const res = await POST(req("POST", "12345"), ctx("12345"));
    expect(res.status).toBe(400);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expectNoWrites();
  });

  test("unknown token → 404, no writes", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    const res = await POST(req("POST", TOKEN), ctx(TOKEN));
    expect(res.status).toBe(404);
    expectNoWrites();
  });
});
