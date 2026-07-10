// WP3-1 · kickDispatch returns its fetch promise so `after(() => kickDispatch())`
// keeps the serverless invocation alive until the kick actually sends, and the
// no-worker path is a resolved no-op. enqueueRekickDispatch degrades gracefully
// (returns false) when the Boxly worker is unset.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { kickDispatch, enqueueRekickDispatch } from "../kick-dispatch";

const OLD_ENV = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env = { ...OLD_ENV };
});
afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe("kickDispatch (WP3-1 · returns a promise)", () => {
  test("returns a Promise that resolves after the fetch settles", async () => {
    process.env.MAPSLY_PUBLIC_URL = "https://www.mapsly.ai";
    process.env.CRON_SECRET = "secret";
    let resolved = false;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    const p = kickDispatch();
    // It's a real promise (thenable) — the caller can await it under after().
    expect(typeof p.then).toBe("function");
    await p.then(() => {
      resolved = true;
    });

    expect(resolved).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/cron/internal/dispatch");
    expect((init as RequestInit).method).toBe("POST");
  });

  test("addresses the WWW host even when the public URL is the apex (apex→www 307 drops the auth header)", async () => {
    // 2026-07-10 · getMapslyPublicUrl forces www so the CRON_SECRET Bearer isn't
    // dropped by Vercel's apex→www redirect (the 'kick-dispatch.rejected 401' bug).
    process.env.MAPSLY_PUBLIC_URL = "https://mapsly.ai";
    process.env.CRON_SECRET = "secret";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await kickDispatch();

    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://www.mapsly.ai/api/cron/internal/dispatch",
    );
  });

  test("swallows a fetch rejection (resolves, never throws)", async () => {
    process.env.MAPSLY_PUBLIC_URL = "https://www.mapsly.ai";
    process.env.CRON_SECRET = "secret";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));

    // Must not reject — the every-2-min cron is the backstop.
    await expect(kickDispatch()).resolves.toBeUndefined();
  });

  test("no-ops (resolved promise) when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(kickDispatch()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("enqueueRekickDispatch (WP3-1 · degraded path)", () => {
  test("returns false + logs when the Boxly worker is unset", async () => {
    delete process.env.BOXLY_WORKER_BASE_URL;
    delete process.env.BOXLY_WORKER_AUTH_TOKEN;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const enqueued = await enqueueRekickDispatch();

    expect(enqueued).toBe(false);
    expect(warn).toHaveBeenCalled(); // degraded path is logged
  });
});
