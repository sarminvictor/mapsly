// WP3-3 · Redis run-progress counters. incr/seed/read round-trip through a fake
// KvClient (in-memory incr/expire/get/set), and every op degrades OPEN when the
// KV client lacks incr/expire (e.g. the @vercel/kv REST backend) or is absent.

import { afterEach, describe, expect, test } from "vitest";

import { __setKvClientForTest, type KvClient } from "@/lib/cache/kv";
import {
  incrRunProgress,
  seedRunProgress,
  readRunProgress,
} from "../run-progress-counter";

/** Minimal in-memory KvClient WITH incr/expire (the ioredis-capable backend). */
function fakeRedisKv(): KvClient & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    async get<T = unknown>(key: string): Promise<T | null> {
      return (store.has(key) ? (store.get(key) as T) : null) ?? null;
    },
    async set(key: string, value: unknown): Promise<unknown> {
      store.set(key, value);
      return "OK";
    },
    async del(...keys: string[]): Promise<number> {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    },
    async scan(): Promise<[string | number, string[]]> {
      return ["0", []];
    },
    async incr(key: string, by = 1): Promise<number> {
      const next = Number(store.get(key) ?? 0) + by;
      store.set(key, next);
      return next;
    },
    async expire(): Promise<number> {
      return 1;
    },
  };
}

afterEach(() => {
  __setKvClientForTest(null);
});

describe("run-progress counters (WP3-3)", () => {
  test("incr → read round-trips done/failed", async () => {
    __setKvClientForTest(fakeRedisKv());
    await incrRunProgress("r1", "done");
    await incrRunProgress("r1", "done");
    await incrRunProgress("r1", "failed");

    const p = await readRunProgress("r1");
    expect(p).not.toBeNull();
    expect(p!.done).toBe(2);
    expect(p!.failed).toBe(1);
  });

  test("seed overwrites (corrects drift) + read returns the shape", async () => {
    __setKvClientForTest(fakeRedisKv());
    await incrRunProgress("r1", "done"); // drift
    await seedRunProgress("r1", {
      done: 40,
      failed: 3,
      total: 50,
      status: "RUNNING",
      retrying: 1,
    });

    const p = await readRunProgress("r1");
    expect(p).toEqual({
      done: 40,
      failed: 3,
      total: 50,
      status: "RUNNING",
      retrying: 1,
    });
  });

  test("retrying defaults to 0 for a legacy seed that predates the key", async () => {
    // A seed WITHOUT `retrying` (older caller) must read back 0, not NaN/null —
    // the banner just omits the hint.
    __setKvClientForTest(fakeRedisKv());
    await seedRunProgress("r1", { done: 5, failed: 0, total: 10 });
    const p = await readRunProgress("r1");
    expect(p!.retrying).toBe(0);
    expect(p!.done).toBe(5);
  });

  test("read returns null (miss) when nothing was written", async () => {
    __setKvClientForTest(fakeRedisKv());
    expect(await readRunProgress("nope")).toBeNull();
  });

  test("degrades open when the KV client lacks incr (REST backend)", async () => {
    // A KvClient WITHOUT incr/expire — like the @vercel/kv REST cast.
    const noIncr: KvClient = {
      async get() {
        return null;
      },
      async set() {
        return "OK";
      },
      async del() {
        return 0;
      },
      async scan(): Promise<[string | number, string[]]> {
        return ["0", []];
      },
    };
    __setKvClientForTest(noIncr);

    // No throw; read returns null (counters never touched).
    await expect(incrRunProgress("r1", "done")).resolves.toBeUndefined();
    await expect(
      seedRunProgress("r1", { done: 1, failed: 0, total: 1 }),
    ).resolves.toBeUndefined();
    expect(await readRunProgress("r1")).toBeNull();
  });

  test("degrades open when KV is absent entirely", async () => {
    __setKvClientForTest(null);
    await expect(incrRunProgress("r1", "done")).resolves.toBeUndefined();
    expect(await readRunProgress("r1")).toBeNull();
  });
});
