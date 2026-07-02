// lib/net/__tests__/ssrf-guard.test.ts · WP8-1 SSRF guard invariants.
//
// Hermetic: node:dns/promises `lookup` is mocked so no real DNS is hit. The
// mock defaults to a benign public address and can be overridden per-test to
// prove DNS-rebinding (public name → private IP) is rejected.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";

// ── Mock node:dns/promises before importing the module under test ──────────
const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

import {
  assertPublicUrl,
  isPrivateIp,
  safeFetch,
  SsrfBlockedError,
} from "../ssrf-guard";

/** Default: every hostname resolves to a benign public address. */
function resolvePublic() {
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
}

beforeEach(() => {
  lookupMock.mockReset();
  resolvePublic();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isPrivateIp", () => {
  const privateV4 = [
    "127.0.0.1",
    "127.255.255.255",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "169.254.0.1",
    "0.0.0.0",
    "100.64.0.1", // CGNAT
    "198.18.0.1", // benchmarking
    "224.0.0.1", // multicast
    "240.0.0.1", // reserved
  ];
  test.each(privateV4)("blocks private IPv4 %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  const publicV4 = [
    "93.184.216.34",
    "8.8.8.8",
    "1.1.1.1",
    "172.15.0.1",
    "172.32.0.1",
    "192.167.0.1",
  ];
  test.each(publicV4)("allows public IPv4 %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });

  const privateV6 = [
    "::1", // loopback
    "::", // unspecified
    "fc00::1", // ULA
    "fd12:3456::1", // ULA
    "fe80::1", // link-local
    "ff02::1", // multicast
    "::ffff:169.254.169.254", // IPv4-mapped metadata
    "::ffff:10.0.0.1", // IPv4-mapped private
  ];
  test.each(privateV6)("blocks private IPv6 %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  const publicV6 = ["2606:4700:4700::1111", "2001:4860:4860::8888"];
  test.each(publicV6)("allows public IPv6 %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });

  test("returns false for a non-IP string (hostname handled via DNS)", () => {
    expect(isPrivateIp("example.com")).toBe(false);
  });
});

describe("assertPublicUrl · protocol + port allowlist", () => {
  test.each([
    "file:///etc/passwd",
    "ftp://example.com/x",
    "gopher://example.com",
    "data:text/plain,hi",
    "javascript:alert(1)",
  ])("rejects non-http(s) protocol: %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  test.each([
    "http://example.com:22/",
    "http://example.com:8080/",
    "https://example.com:2375/",
  ])("rejects odd port: %s", async (url) => {
    const err = await assertPublicUrl(url).catch((e) => e);
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect((err as SsrfBlockedError).reason).toBe("bad-port");
  });

  test("rejects a garbage URL", async () => {
    const err = await assertPublicUrl("not a url").catch((e) => e);
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect((err as SsrfBlockedError).reason).toBe("invalid-url");
  });

  test.each([
    "http://example.com/",
    "https://example.com/",
    "http://example.com:80/",
    "https://example.com:443/path?q=1",
  ])("accepts http(s) on default ports: %s", async (url) => {
    await expect(assertPublicUrl(url)).resolves.toBeInstanceOf(URL);
  });
});

describe("assertPublicUrl · IP-literal hosts (no DNS)", () => {
  test.each([
    "http://127.0.0.1/",
    "http://10.0.0.5/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.1.1/",
    "http://[::1]/",
    "http://[fd00::1]/",
  ])("rejects private IP literal: %s", async (url) => {
    const err = await assertPublicUrl(url).catch((e) => e);
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect((err as SsrfBlockedError).reason).toBe("private-ip-literal");
    // DNS must NOT be consulted for an IP literal.
    expect(lookupMock).not.toHaveBeenCalled();
  });

  test("accepts a public IP literal without DNS", async () => {
    await expect(
      assertPublicUrl("http://93.184.216.34/"),
    ).resolves.toBeInstanceOf(URL);
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe("assertPublicUrl · DNS resolution (rebinding defense)", () => {
  test("rejects a public hostname that resolves to a private IP", async () => {
    lookupMock.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);
    const err = await assertPublicUrl("https://rebind.evil.example/").catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect((err as SsrfBlockedError).reason).toBe("private-resolved-ip");
  });

  test("rejects when ANY resolved address is private (mixed A records)", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    await expect(
      assertPublicUrl("https://mixed.example/"),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  test("accepts a public hostname resolving to public addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(
      assertPublicUrl("https://example.com/"),
    ).resolves.toBeInstanceOf(URL);
    expect(lookupMock).toHaveBeenCalledWith("example.com", {
      all: true,
      verbatim: true,
    });
  });

  test("does NOT block on DNS failure (lets the caller's fetch fail naturally)", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(
      assertPublicUrl("https://nonexistent.example/"),
    ).resolves.toBeInstanceOf(URL);
  });
});

describe("safeFetch · redirect re-validation", () => {
  // Re-create the spy each test: the outer afterEach runs vi.restoreAllMocks(),
  // so a describe-scoped spy would be un-spied after the first case.
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test("returns a non-redirect response directly", async () => {
    resolvePublic();
    const ok = new Response("hi", { status: 200 });
    fetchSpy.mockResolvedValue(ok);
    const res = await safeFetch("https://example.com/");
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // manual redirect handling
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  test("blocks a 302 redirect to cloud metadata", async () => {
    resolvePublic();
    const redirect = new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data/" },
    });
    fetchSpy.mockResolvedValue(redirect);
    const err = await safeFetch("https://example.com/").catch((e) => e);
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect((err as SsrfBlockedError).reason).toBe("private-ip-literal");
    // it made the first hop, then refused to follow the bad Location.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("follows a redirect to another public URL", async () => {
    resolvePublic();
    fetchSpy
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "https://example.com/final" },
        }),
      )
      .mockResolvedValueOnce(new Response("done", { status: 200 }));
    const res = await safeFetch("https://example.com/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("done");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test("rejects the initial URL before any fetch when it is private", async () => {
    const err = await safeFetch("http://127.0.0.1/").catch((e) => e);
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("bounds redirect chains and throws too-many-redirects", async () => {
    resolvePublic();
    // Always redirect to another public URL → exceed the hop budget.
    fetchSpy.mockImplementation(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://example.com/loop" },
        }),
    );
    const err = await safeFetch("https://example.com/").catch((e) => e);
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect((err as SsrfBlockedError).reason).toBe("too-many-redirects");
  });

  test("passes caller headers + signal through", async () => {
    resolvePublic();
    fetchSpy.mockResolvedValue(new Response("ok", { status: 200 }));
    const controller = new AbortController();
    await safeFetch("https://example.com/", {
      headers: { "User-Agent": "MapslyBot" },
      signal: controller.signal,
    });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ "User-Agent": "MapslyBot" });
    expect(init.signal).toBe(controller.signal);
  });
});
